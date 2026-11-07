"""In-app problem reports (#109): what the person wrote, their model if they chose to attach it, and what the app
collected (the last 20 actions, browser, the last kernel error). Each is kept in DATA_DIR/reports/<id>/ and sent on
to Kev by email (REPORT_EMAIL and SMTP_*) or as an issue in a private repository (GITHUB_REPORT_TOKEN and
GITHUB_REPORT_REPO). Nothing is ever sent without the person pressing Send.
"""

import json
import logging
import secrets
import smtplib
import threading
import time
import urllib.request
from collections import defaultdict, deque
from email.message import EmailMessage
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .settings import Settings

log = logging.getLogger("bettercad.reports")

MAX_BYTES = 2 * 1024 * 1024
PER_HOUR = 5
WAIT = "You've sent a few reports in the last hour. Try again later, or download the report and email it."


class Report(BaseModel):
    description: str = Field(max_length=10_000)
    model: str | None = Field(default=None, description="The .bcad text, when the person attached it")
    info: dict = Field(default_factory=dict, description="Actions, browser and the last error, as the dialog showed them")


class HourlyLimit:
    """Reports per address per hour, in memory: the app is one process on one machine."""

    def __init__(self, limit: int = PER_HOUR, window: float = 3600.0) -> None:
        self.limit, self.window = limit, window
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = self.hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(429, WAIT)
        hits.append(now)


def summary(report_id: str, r: Report) -> str:
    actions = r.info.get("actions") or []
    lines = [
        f"Report {report_id}",
        "",
        r.description.strip() or "(No description.)",
        "",
        f"Model attached: {'yes' if r.model else 'no'}",
        f"App: {r.info.get('app', '?')}",
        f"Browser: {r.info.get('browser', '?')}",
        f"Last error: {r.info.get('error') or 'none'}",
        "",
        "Last actions:",
        *[f"  {a.get('at', '')} {a.get('id', '')} {a.get('detail', '')}".rstrip() for a in actions[-20:] if isinstance(a, dict)],
    ]
    return "\n".join(lines)


def send_email(settings: Settings, report_id: str, r: Report, text: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = f"BetterCad report {report_id}: {r.description.strip()[:60] or 'no description'}"
    msg["From"] = settings.smtp_from or settings.report_email
    msg["To"] = settings.report_email
    msg.set_content(text)
    if r.model:
        msg.add_attachment(r.model.encode(), maintype="application", subtype="json", filename=f"report-{report_id}.bcad")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
        s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)


def send_issue(settings: Settings, report_id: str, r: Report, text: str) -> None:
    body = f"```\n{text}\n```\n\nThe model, if attached, is on the server in `reports/{report_id}/`."
    req = urllib.request.Request(
        f"https://api.github.com/repos/{settings.github_report_repo}/issues",
        data=json.dumps(
            {"title": f"Report {report_id}: {r.description.strip()[:60]}", "body": body, "labels": ["report"]}
        ).encode(),
        headers={"Authorization": f"Bearer {settings.github_report_token}", "Accept": "application/vnd.github+json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20):
        pass


def forward(settings: Settings, report_id: str, r: Report) -> None:
    """Email by default; a private GitHub issue when that's what is configured. Failures are logged, never shown."""
    text = summary(report_id, r)
    try:
        if settings.report_email and settings.smtp_host:
            send_email(settings, report_id, r, text)
        elif settings.github_report_token and settings.github_report_repo:
            send_issue(settings, report_id, r, text)
    except Exception:  # noqa: BLE001 - the report is stored either way
        log.exception("Couldn't forward report %s", report_id)


def router(settings: Settings) -> APIRouter:
    r = APIRouter(prefix="/api")
    limit = HourlyLimit()

    @r.post("/report", status_code=201)
    async def report(request: Request) -> dict:
        raw = await request.body()
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, "That report is over 2 MB. Download it instead and email it.")
        try:
            body = Report.model_validate_json(raw)
        except ValueError:
            raise HTTPException(422, "That report isn't readable.") from None
        limit.check(request.client.host if request.client else "unknown")
        report_id = secrets.token_hex(4)
        folder: Path = settings.data_dir / "reports" / report_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "report.json").write_text(
            json.dumps({"id": report_id, "at": time.time(), "description": body.description, "info": body.info}, indent=2)
        )
        if body.model:
            (folder / "model.bcad").write_text(body.model)
        threading.Thread(target=forward, args=(settings, report_id, body), daemon=True).start()
        return {"id": report_id}

    return r
