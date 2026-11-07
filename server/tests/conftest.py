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


def sign_up(client: TestClient, email: str = "kev@example.com", name: str = "Kev") -> dict:
    """Signs up and sets the CSRF header on the client for later writes."""
    r = client.post("/api/auth/signup", json={"email": email, "name": name, "password": "correct horse"})
    assert r.status_code == 201, r.text
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    return r.json()


@pytest.fixture
def user(make_client):
    with make_client() as client:
        sign_up(client)
        yield client
