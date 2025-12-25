from __future__ import annotations

import re


_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")
_BOLD_LINE_RE = re.compile(r"^\s*\*\*(.+?)\*\*\s*$")
_OPTION_RE = re.compile(r"^\s*([A-Z])[\.)]\s+(.*)$")
_ANSWER_RE = re.compile(r"^\s*(?:\*\*)?(?:answer|correct\s*answer|ans)\s*[:：]\s*(.+?)\s*(?:\*\*)?\s*$", re.IGNORECASE)


def _strip_inline_md(text: str) -> str:
    text = text.strip()
    if text.startswith("**") and text.endswith("**") and len(text) >= 4:
        text = text[2:-2].strip()
    if text.startswith("*") and text.endswith("*") and len(text) >= 2:
        text = text[1:-1].strip()
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"(?<!\*)\*(.+?)\*(?!\*)", r"\1", text)
    text = text.replace("\\.", ".")
    return re.sub(r"\s+", " ", text).strip()


def _section_kind(title: str) -> str | None:
    t = title.lower()
    if "true" in t and "false" in t:
        return "true_false"
    if "short" in t and "answer" in t:
        return "short_answer"
    if "multiple" in t and "choice" in t:
        return "multiple_choice"
    return None


def parse_quiz_markdown(markdown: str) -> list[dict]:
    """Parse a simple quiz markdown format into sections/questions.

    Output shape:
      [{"title": str, "kind": str|None, "questions": [ {"title": str, "type": str, ...} ]}]
    """

    sections: list[dict] = []
    current_section: dict | None = None
    current_question: dict | None = None
    current_options: list[str] = []
    current_answer: str | None = None
    saw_short_answer_prompt = False

    def flush_question() -> None:
        nonlocal current_question, current_options, current_answer, saw_short_answer_prompt, current_section
        if not current_question:
            return

        if current_section is None:
            current_section = {"title": "Questions", "kind": None, "questions": []}
            sections.append(current_section)

        kind = current_section.get("kind")
        qtype = None
        if kind == "short_answer":
            qtype = "short_answer"
        elif kind == "true_false":
            qtype = "true_false"
        elif current_options:
            qtype = "multiple_choice"
        elif saw_short_answer_prompt:
            qtype = "short_answer"
        else:
            qtype = "short_answer"

        q: dict = {"title": current_question["title"], "type": qtype}
        if qtype == "multiple_choice":
            q["options"] = list(current_options)
        if qtype == "true_false":
            q["options"] = ["True", "False"]
        if current_answer:
            q["answer"] = current_answer

        current_section["questions"].append(q)

        current_question = None
        current_options = []
        current_answer = None
        saw_short_answer_prompt = False

    def flush_section() -> None:
        nonlocal current_section
        if current_section is None:
            return
        if not current_section.get("questions"):
            sections.pop()
        current_section = None

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip("\n")
        stripped = line.strip()
        if not stripped:
            continue
        if stripped in {"---", "----", "-----"}:
            continue

        heading_match = _HEADING_RE.match(line)
        if heading_match:
            level = len(heading_match.group(1))
            text = _strip_inline_md(heading_match.group(2))

            if level <= 2:
                flush_question()
                if current_section is not None:
                    flush_section()
                current_section = {"title": text, "kind": _section_kind(text), "questions": []}
                sections.append(current_section)
                continue

            # level >= 3: likely a question
            cleaned = _strip_inline_md(text)
            if re.match(r"^\d+\s*[\.:)]\s*", cleaned) or re.match(r"^\d+\b", cleaned):
                flush_question()
                current_question = {"title": cleaned}
                continue

        bold_line_match = _BOLD_LINE_RE.match(line)
        if bold_line_match:
            text = _strip_inline_md(bold_line_match.group(1))
            if text:
                flush_question()
                if current_section is not None:
                    flush_section()
                current_section = {"title": text, "kind": _section_kind(text), "questions": []}
                sections.append(current_section)
                continue

        if stripped.startswith("###"):
            # e.g. ### **1\. Question**
            title = _strip_inline_md(stripped.lstrip("#").strip())
            flush_question()
            current_question = {"title": title}
            continue

        if current_question is None:
            continue

        answer_match = _ANSWER_RE.match(stripped)
        if answer_match:
            current_answer = _strip_inline_md(answer_match.group(1))
            continue

        if stripped.lower().startswith("*answer"):
            saw_short_answer_prompt = True
            continue

        option_match = _OPTION_RE.match(stripped)
        if option_match:
            current_options.append(_strip_inline_md(option_match.group(2)))
            continue

    flush_question()
    flush_section()

    return sections
