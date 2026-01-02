# Quiz Form Generator

Convert a quiz written in a Google Doc (or a simple Markdown file) into a **Google Forms quiz**.

This repo includes two ways to generate quizzes:

1. **Google Docs → Google Forms (Apps Script)**: paste `QuizFormGenerator.gs` into a Google Doc’s Apps Script editor and run from a custom menu.
2. **Markdown → Google Forms (Python)**: parse a `.md` file and create a quiz via the **Google Forms API** (CLI or a tiny local web UI).

## Features

- Multiple choice (A–H)
- True/False sections
- Short answer questions
- Optional answer key support (adds auto-grading for supported types)
- “Preview” mode (Apps Script) and `--dry-run` (Python) to inspect parsing/output

## Quick start (Google Docs / Apps Script)

1. Open your Google Doc with quiz questions.
2. Go to **Extensions → Apps Script**.
3. Replace the editor contents with `QuizFormGenerator.gs`, save, close.
4. Reload the Google Doc.
5. Use **Quiz Tools → Preview Only** (recommended), then **Quiz Tools → Create Quiz Form**.

For a step-by-step walkthrough and supported formatting, see `SETUP.md`.

## Using Markdown (Python)

### Requirements

- Python 3
- Google OAuth client credentials (`credentials.json`) for the Google Forms API

Install deps (minimal set used by the scripts):

```bash
python3 -m pip install google-api-python-client google-auth google-auth-oauthlib
```

### CLI

Dry-run (prints the Forms API payload without creating anything):

```bash
python3 generate_form.py --input "example quiz.md" --title "My Quiz" --dry-run
```

Create the form:

```bash
python3 generate_form.py --input "example quiz.md" --title "My Quiz"
```

On first run, a browser window will open to authorize; a local `token.json` is written for reuse.

### Local web UI

```bash
python3 web_app.py --host 127.0.0.1 --port 8000
```

Then open `http://127.0.0.1:8000/`, upload a Markdown file, and optionally run in “dry run” mode.

## Input format

### Google Docs (plain text)

- Section headers like `Part 1 – Multiple choice`, `Part 2 – True / False`, etc.
- Questions start with a number (e.g. `1. ...`).
- Options look like `A. ...` / `B) ...`.
- Answer lines like `Answer: B`, `Answer: True`, or `Answer: <full option text>`.

### Markdown

- Section headings: `#` / `##` or a bold-only line like `**Part 1 – Multiple Choice**`.
- Questions: typically `### 1. ...`.
- Options: `A. ...`, `B. ...` etc (can be one-per-line).
- Answer lines: `Answer: ...` / `Correct Answer: ...`.

See `example quiz.md` and `example quiz.txt` for working examples.

## Notes

- Auto-grading is applied to multiple choice / true-false when an answer key is present; short-answer questions are created as required text items.
- Sensitive files (`credentials.json`, `token.json`, `.env`) are ignored by git via `.gitignore`.