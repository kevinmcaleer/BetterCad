import pytest
from fastapi.testclient import TestClient

from bettercad.main import create_app
from bettercad.settings import Settings


@pytest.fixture
def make_client(tmp_path):
    def make(**overrides) -> TestClient:
        settings = Settings(data_dir=tmp_path, version="test", jobs=False, **overrides)
        return TestClient(create_app(settings))

    return make


BCAD = (
    '{"schema": 1, "app": "bettercad", "name": "Box", "document": {"features": []}, '
    '"thumbnail": "data:image/png;base64,iVBORw0KGgo="}'
)


PASSWORD = "correct horse battery"


def csrf(client: TestClient) -> str:
    """Asks for a CSRF token (bound to the anonymous or session cookie) and sends it from now on."""
    token = client.get("/api/auth/session").json()["csrf_token"]
    client.headers["X-CSRF-Token"] = token
    return token


def sign_up(client: TestClient, email: str = "kev@example.com", name: str = "Kev") -> dict:
    """Registers `name` with powertools-auth and sets the CSRF header on the client for later writes."""
    csrf(client)
    r = client.post("/api/auth/register", json={"username": name, "email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    client.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return r.json()["user"]


@pytest.fixture
def user(make_client):
    with make_client() as client:
        sign_up(client)
        yield client
