import json

from bettercad import reports
from bettercad.settings import Settings


def test_a_report_is_stored_with_its_model(make_client, tmp_path):
    with make_client() as client:
        r = client.post(
            "/api/report",
            json={"description": "The fillet failed", "model": '{"schema": 1}', "info": {"actions": [{"id": "tool.fillet"}]}},
        )
        assert r.status_code == 201, r.text
        rid = r.json()["id"]
    folder = tmp_path / "reports" / rid
    assert json.loads((folder / "report.json").read_text())["description"] == "The fillet failed"
    assert (folder / "model.bcad").read_text() == '{"schema": 1}'


def test_without_the_model_only_the_report_is_kept(make_client, tmp_path):
    with make_client() as client:
        rid = client.post("/api/report", json={"description": "Slow", "info": {}}).json()["id"]
    assert not (tmp_path / "reports" / rid / "model.bcad").exists()


def test_five_an_hour_per_address(make_client):
    with make_client() as client:
        for _ in range(5):
            assert client.post("/api/report", json={"description": "x"}).status_code == 201
        r = client.post("/api/report", json={"description": "x"})
        assert r.status_code == 429
        assert "download the report" in r.json()["detail"]


def test_over_2_mb_is_refused(make_client):
    with make_client() as client:
        r = client.post("/api/report", json={"description": "big", "model": "x" * (2 * 1024 * 1024)})
        assert r.status_code == 413


def test_unreadable_reports_are_refused(make_client):
    with make_client() as client:
        assert client.post("/api/report", content=b"not json", headers={"Content-Type": "application/json"}).status_code == 422


def test_forward_emails_when_configured(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr(reports, "send_email", lambda s, i, r, text: sent.append((i, text)))
    monkeypatch.setattr(reports, "send_issue", lambda *a: sent.append("issue"))
    body = reports.Report(description="It broke", info={"app": "1.0", "actions": [{"id": "file.save", "at": "10:00"}]})
    reports.forward(Settings(data_dir=tmp_path, report_email="kev@example.com", smtp_host="smtp.example.com"), "ab12cd34", body)
    assert sent[0][0] == "ab12cd34"
    assert "It broke" in sent[0][1] and "file.save" in sent[0][1]
    # Nothing configured: kept on the server only.
    sent.clear()
    reports.forward(Settings(data_dir=tmp_path), "ab12cd34", body)
    assert sent == []


def test_forward_files_an_issue_when_that_is_configured(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr(reports, "send_issue", lambda s, i, r, text: sent.append(i))
    reports.forward(
        Settings(data_dir=tmp_path, github_report_token="t", github_report_repo="kev/reports"),
        "ab12cd34",
        reports.Report(description="x"),
    )
    assert sent == ["ab12cd34"]


def test_a_failed_forward_is_logged_not_raised(monkeypatch, tmp_path, caplog):
    def boom(*a):
        raise OSError("no route")

    monkeypatch.setattr(reports, "send_email", boom)
    reports.forward(
        Settings(data_dir=tmp_path, report_email="k@example.com", smtp_host="smtp"), "ab12cd34", reports.Report(description="x")
    )
    assert "Couldn't forward report ab12cd34" in caplog.text
