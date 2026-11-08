import pytest
from fastapi.testclient import TestClient

from bettercad.main import create_app
from bettercad.settings import Settings


class FakeKevsrobots:
    """Stands in for Chatter, kevsrobots.com's accounts: tokens to users."""

    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.down = False

    def add(self, username: str, email: str) -> str:
        token = f"tok-{username}-{len(self.users)}"
        self.users[token] = {"id": 100 + len(self.users), "username": username, "email": email}
        return token

    def identify(self, token: str) -> dict | None:
        if self.down:
            raise OSError("down")
        return self.users.get(token)


@pytest.fixture
def kevsrobots():
    return FakeKevsrobots()


@pytest.fixture
def make_client(tmp_path, kevsrobots):
    def make(**overrides) -> TestClient:
        settings = Settings(data_dir=tmp_path, version="test", jobs=False, **overrides)
        app = create_app(settings)
        app.state.identify = kevsrobots.identify
        client = TestClient(app)
        client.kevsrobots = kevsrobots  # type: ignore[attr-defined]
        return client

    return make


BCAD = (
    '{"schema": 1, "app": "bettercad", "name": "Box", "document": {"features": []}, '
    '"thumbnail": "data:image/png;base64,iVBORw0KGgo="}'
)


def csrf(client: TestClient) -> str:
    """Asks for the CSRF token of the signed-in kevsrobots.com account and sends it from now on."""
    token = client.get("/api/auth/session").json()["csrf_token"]
    client.headers["X-CSRF-Token"] = token
    return token


def sign_up(client: TestClient, email: str = "kev@example.com", name: str = "Kev") -> dict:
    """Makes a kevsrobots.com account, signs this client in with its cookie and sets the CSRF header."""
    token = client.kevsrobots.add(name, email)  # type: ignore[attr-defined]
    client.cookies.set("access_token", f"Bearer {token}")
    csrf(client)
    return client.get("/api/account").json()


@pytest.fixture
def user(make_client):
    with make_client() as client:
        sign_up(client)
        yield client
