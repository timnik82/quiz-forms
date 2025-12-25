from __future__ import annotations

import argparse
import html
import json
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from generate_form import authorize, build_requests_from_sections, quiz_settings_request
from quiz_markdown import parse_quiz_markdown


MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MiB


def _parse_content_type(value: str) -> tuple[str, dict[str, str]]:
    parts = [p.strip() for p in value.split(";") if p.strip()]
    ctype = parts[0].lower() if parts else ""
    params: dict[str, str] = {}
    for p in parts[1:]:
        if "=" not in p:
            continue
        k, v = p.split("=", 1)
        k = k.strip().lower()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] == '"':
            v = v[1:-1]
        params[k] = v
    return ctype, params


def _parse_multipart_form_data(content_type: str, body: bytes) -> tuple[dict[str, str], dict[str, dict]]:
    # Parse multipart/form-data without the deprecated/removed `cgi` module.
    msg = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + content_type.encode("utf-8") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    if not msg.is_multipart():
        raise ValueError("Not a multipart request")

    fields: dict[str, str] = {}
    files: dict[str, dict] = {}

    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        filename = part.get_param("filename", header="content-disposition")
        data = part.get_payload(decode=True) or b""
        if filename:
            files[name] = {
                "filename": filename,
                "content_type": part.get_content_type(),
                "data": data,
            }
            continue

        charset = part.get_content_charset() or "utf-8"
        fields[name] = data.decode(charset, errors="replace")

    return fields, files


def _page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>{html.escape(title)}</title>
  </head>
  <body>
    {body}
  </body>
</html>
"""


def _index_page() -> str:
    return _page(
        "Markdown → Google Form",
        """
<h1>Markdown → Google Form</h1>
<form action=\"/create\" method=\"post\" enctype=\"multipart/form-data\">
  <div>
    <label>Form title: <input type=\"text\" name=\"title\" value=\"Quiz\" /></label>
  </div>
  <div>
    <label>Markdown file: <input type=\"file\" name=\"file\" accept=\".md,text/markdown,text/plain\" required /></label>
  </div>
  <div>
    <label><input type=\"checkbox\" name=\"dry_run\" value=\"1\" checked /> Dry run (don't create a form)</label>
  </div>
  <div>
    <button type=\"submit\">Create</button>
  </div>
</form>
""",
    )


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in {"/", "/index.html"}:
            self._send_html(HTTPStatus.OK, _index_page())
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        if self.path != "/create":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = self.headers.get("Content-Type")
        if not content_type:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing Content-Type")
            return
        ctype, params = _parse_content_type(content_type)
        if ctype != "multipart/form-data" or "boundary" not in params:
            self.send_error(HTTPStatus.BAD_REQUEST, "Expected multipart/form-data")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return
        if length > MAX_UPLOAD_SIZE:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Upload too large")
            return
        body = self.rfile.read(length)

        try:
            fields, files = _parse_multipart_form_data(content_type, body)
        except (ValueError, TypeError) as e:
            self.send_error(HTTPStatus.BAD_REQUEST, f"Could not parse multipart body: {e}")
            return

        title = (fields.get("title") or "Quiz").strip() or "Quiz"
        dry_run = "dry_run" in fields

        if "file" not in files:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing file")
            return

        try:
            raw = files["file"]["data"]
            markdown = raw.decode("utf-8-sig")
        except UnicodeDecodeError as e:
            self.send_error(HTTPStatus.BAD_REQUEST, f"Could not read uploaded file: {e}")
            return

        try:
            sections = parse_quiz_markdown(markdown)
            requests = build_requests_from_sections(sections)
        except ValueError as e:
            self.send_error(HTTPStatus.BAD_REQUEST, f"Could not parse markdown: {e}")
            return

        create_body = {"info": {"title": title}}
        requests = [quiz_settings_request(), *requests]

        if dry_run:
            payload = json.dumps({"create": create_body, "batchUpdate": {"requests": requests}}, indent=2)
            self._send_html(
                HTTPStatus.OK,
                _page(
                    "Dry run",
                    f"""
<h1>Dry run</h1>
<p>No form was created.</p>
<pre>{html.escape(payload)}</pre>
<p><a href=\"/\">Back</a></p>
""",
                ),
            )
            return

        try:
            service = authorize()
        except ModuleNotFoundError as e:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Missing Google dependencies: {e}")
            return
        except FileNotFoundError as e:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Missing credentials.json: {e}")
            return
        except OSError as e:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"OAuth credential/token error: {e}")
            return

        from googleapiclient.errors import HttpError

        try:
            form_obj = service.forms().create(body=create_body).execute()
            form_id = form_obj.get("formId")
            if not form_id:
                self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Google API error: missing formId in response")
                return
            service.forms().batchUpdate(formId=form_id, body={"requests": requests}).execute()
            result = service.forms().get(formId=form_id).execute()
        except HttpError as e:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Google API error: {e}")
            return
        except (OSError, TimeoutError, ConnectionError) as e:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Google API/network error: {e}")
            return

        responder_uri = result.get("responderUri", "")
        form_id = form_obj.get("formId", "")
        self._send_html(
            HTTPStatus.OK,
            _page(
                "Created",
                f"""
<h1>Created</h1>
<p><b>formId:</b> {html.escape(form_id)}</p>
<p><b>responderUri:</b> <a href=\"{html.escape(responder_uri)}\">{html.escape(responder_uri)}</a></p>
<p><a href=\"/\">Create another</a></p>
""",
            ),
        )

    def _send_html(self, status: HTTPStatus, content: str) -> None:
        body = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Local web UI for creating a Google Form from markdown")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Open http://{args.host}:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
