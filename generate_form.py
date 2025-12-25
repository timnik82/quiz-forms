from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from quiz_markdown import parse_quiz_markdown

SCOPES = [
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.body.readonly",
    "https://www.googleapis.com/auth/forms.responses.readonly",
]

QUIZ_TITLE = "ATS Quiz"

multiple_choice = [
    {
        "title": "1. What is the main purpose of Air Traffic Services (ATS)?",
        "options": [
            "Reduce flight prices",
            "Ensure safe, orderly flow of air traffic",
            "Train pilots",
            "Manage airline operations",
        ],
        "answer": "Ensure safe, orderly flow of air traffic",
    },
    {
        "title": "2. Which organization defines global aviation standards?",
        "options": ["ICAO", "EUROCONTROL", "EASA", "IATA"],
        "answer": "ICAO",
    },
    {
        "title": "3. Class A airspace is typically used for:",
        "options": ["VFR only", "IFR only", "Both IFR and VFR", "Military aircraft only"],
        "answer": "IFR only",
    },
    {
        "title": "4. Which unit provides en-route air traffic control?",
        "options": ["TWR", "APP", "ACC", "AIS"],
        "answer": "ACC",
    },
    {
        "title": "5. A Flight Information Region (FIR) provides:",
        "options": [
            "ATC only",
            "FIS and alerting service",
            "Customs and immigration",
            "Slot coordination",
        ],
        "answer": "FIS and alerting service",
    },
    {
        "title": "6. ATFM primarily aims to:",
        "options": [
            "Increase airline profits",
            "Balance demand and capacity",
            "Reduce controller workload",
            "Provide weather forecasts",
        ],
        "answer": "Balance demand and capacity",
    },
    {
        "title": "7. GAT refers to air traffic that:",
        "options": [
            "Follows ICAO rules",
            "Is military only",
            "Does not require ATC",
            "Flies only VFR",
        ],
        "answer": "Follows ICAO rules",
    },
    {
        "title": "8. The Flexible Use of Airspace (FUA) concept promotes:",
        "options": [
            "Exclusive use by military",
            "Shared civil-military operation",
            "Permanent airspace closure",
            "Drone-only flight corridors",
        ],
        "answer": "Shared civil-military operation",
    },
    {
        "title": "9. Which body acts as the Network Manager in Europe?",
        "options": ["ICAO", "IATA", "EUROCONTROL", "FAA"],
        "answer": "EUROCONTROL",
    },
    {
        "title": "10. Which service provides essential information for safe flight operations?",
        "options": ["ATC", "FIS", "MET", "AIS"],
        "answer": "AIS",
    },
]

true_false = [
    {"title": "11. VFR flights require continuous visual reference to the ground.", "answer": "True"},
    {"title": "12. All European countries operate under a single ANSP.", "answer": "False"},
    {"title": "13. Alerting service is part of ATS.", "answer": "True"},
    {"title": "14. Airspace classes A–G are internationally standardized.", "answer": "True"},
    {"title": "15. ATM includes both air and ground components.", "answer": "True"},
]

short_answers = [
    "16. What is the main difference between a CTR and a TMA?",
    "17. Why is Airspace Management divided into 3 levels (strategic, pre-tactical, tactical)?",
    "18. What is the purpose of a CTOT in ATFM?",
    "19. Describe two key performance areas (KPAs) used to evaluate ATM.",
    "20. What is the role of ICAO in relation to national regulations?",
]


def authorize() -> Any:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    token_path = Path("token.json")
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json())
    return build("forms", "v1", credentials=creds)


def build_requests() -> list[dict]:
    requests: list[dict] = []
    idx = 0
    requests.append(
        {
            "createItem": {
                "item": {"title": "Part 1 – Multiple choice", "pageBreakItem": {}},
                "location": {"index": idx},
            }
        }
    )
    idx += 1
    for q in multiple_choice:
        requests.append(
            {
                "createItem": {
                    "item": {
                        "title": q["title"],
                        "questionItem": {
                            "question": {
                                "required": True,
                                "grading": {
                                    "pointValue": 1,
                                    "correctAnswers": {
                                        "answers": [{"value": q["answer"]}]
                                    },
                                },
                                "choiceQuestion": {
                                    "type": "RADIO",
                                    "options": [{"value": opt} for opt in q["options"]],
                                    "shuffle": False,
                                },
                            }
                        },
                    },
                    "location": {"index": idx},
                }
            }
        )
        idx += 1

    requests.append(
        {
            "createItem": {
                "item": {"title": "Part 2 – True / False", "pageBreakItem": {}},
                "location": {"index": idx},
            }
        }
    )
    idx += 1
    for q in true_false:
        requests.append(
            {
                "createItem": {
                    "item": {
                        "title": q["title"],
                        "questionItem": {
                            "question": {
                                "required": True,
                                "grading": {
                                    "pointValue": 1,
                                    "correctAnswers": {
                                        "answers": [{"value": q["answer"]}]
                                    },
                                },
                                "choiceQuestion": {
                                    "type": "RADIO",
                                    "options": [{"value": "True"}, {"value": "False"}],
                                    "shuffle": False,
                                },
                            }
                        },
                    },
                    "location": {"index": idx},
                }
            }
        )
        idx += 1

    requests.append(
        {
            "createItem": {
                "item": {"title": "Part 3 – Short Answer", "pageBreakItem": {}},
                "location": {"index": idx},
            }
        }
    )
    idx += 1
    for title in short_answers:
        requests.append(
            {
                "createItem": {
                    "item": {
                        "title": title,
                        "questionItem": {
                            "question": {
                                "required": True,
                                "textQuestion": {"paragraph": False},
                            }
                        },
                    },
                    "location": {"index": idx},
                }
            }
        )
        idx += 1
    return requests


def _normalize_choice_answer(answer: str, options: list[str]) -> str | None:
    a = answer.strip()
    if len(a) == 1 and "A" <= a.upper() <= "Z":
        idx = ord(a.upper()) - ord("A")
        if 0 <= idx < len(options):
            return options[idx]
        return None
    for opt in options:
        if opt.strip().lower() == a.lower():
            return opt
    return None


def _normalize_true_false_answer(answer: str) -> str | None:
    a = answer.strip().lower()
    if a in {"t", "true"}:
        return "True"
    if a in {"f", "false"}:
        return "False"
    return None


def build_requests_from_sections(sections: list[dict]) -> list[dict]:
    requests: list[dict] = []
    idx = 0

    for section in sections:
        title = section.get("title") or "Section"
        requests.append(
            {
                "createItem": {
                    "item": {"title": title, "pageBreakItem": {}},
                    "location": {"index": idx},
                }
            }
        )
        idx += 1

        for q in section.get("questions", []):
            qtitle = q.get("title") or "Question"
            qtype = q.get("type")
            qanswer = q.get("answer")

            if qtype in {"multiple_choice", "true_false"}:
                options = list(q.get("options") or [])
                if qtype == "true_false":
                    options = ["True", "False"]
                if len(options) < 2:
                    qtype = "short_answer"
                else:
                    question: dict = {
                        "required": True,
                        "choiceQuestion": {
                            "type": "RADIO",
                            "options": [{"value": opt} for opt in options],
                            "shuffle": False,
                        },
                    }

                    if qanswer:
                        if qtype == "true_false":
                            normalized = _normalize_true_false_answer(qanswer)
                        else:
                            normalized = _normalize_choice_answer(qanswer, options)
                        if normalized:
                            question["grading"] = {
                                "pointValue": 1,
                                "correctAnswers": {"answers": [{"value": normalized}]},
                            }

                    item = {"title": qtitle, "questionItem": {"question": question}}
                    requests.append(
                        {"createItem": {"item": item, "location": {"index": idx}}}
                    )
                    idx += 1
                    continue

            if qtype == "short_answer":
                item = {
                    "title": qtitle,
                    "questionItem": {
                        "question": {
                            "required": True,
                            "textQuestion": {"paragraph": False},
                        }
                    },
                }
                requests.append(
                    {"createItem": {"item": item, "location": {"index": idx}}}
                )
                idx += 1

    return requests


def quiz_settings_request() -> dict:
    return {
        "updateSettings": {
            "settings": {"quizSettings": {"isQuiz": True}},
            "updateMask": "quizSettings.isQuiz",
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Create a Google Forms quiz.")
    parser.add_argument("--dry-run", action="store_true", help="Print the Google Forms API payloads without creating a form")
    parser.add_argument("--title", default=QUIZ_TITLE, help="Form title")
    parser.add_argument("--input", type=Path, help="Path to a markdown quiz file to convert")
    args = parser.parse_args()

    create_body = {"info": {"title": args.title}}
    if args.input:
        try:
            content = args.input.read_text(encoding="utf-8")
        except OSError as e:
            print(f"Error reading {args.input}: {e}", file=sys.stderr)
            sys.exit(1)
        sections = parse_quiz_markdown(content)
        requests = build_requests_from_sections(sections)
    else:
        requests = build_requests()

    requests = [quiz_settings_request(), *requests]

    if args.dry_run:
        print(json.dumps({"create": create_body, "batchUpdate": {"requests": requests}}, indent=2))
        return

    try:
        service = authorize()
        form = service.forms().create(body=create_body).execute()
        service.forms().batchUpdate(formId=form["formId"], body={"requests": requests}).execute()
        result = service.forms().get(formId=form["formId"]).execute()
    except Exception as e:
        print(f"Google API error: {e}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps({"formId": form["formId"], "responderUri": result["responderUri"]}, indent=2))


if __name__ == "__main__":
    main()
