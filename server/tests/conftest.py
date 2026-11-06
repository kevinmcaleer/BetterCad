import pytest
from fastapi.testclient import TestClient

from bettercad.main import create_app
from bettercad.settings import Settings


@pytest.fixture
def make_client(tmp_path):
    def make(**overrides) -> TestClient:
        settings = Settings(data_dir=tmp_path, version="test", **overrides)
        return TestClient(create_app(settings))

    return make
