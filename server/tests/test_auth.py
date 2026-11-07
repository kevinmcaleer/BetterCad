from conftest import sign_up

from bettercad.auth import check_password, hash_password


def test_password_hash_round_trip():
    h = hash_password("hunter22")
    assert h.startswith("scrypt$") and "hunter22" not in h
    assert check_password("hunter22", h)
    assert not check_password("hunter23", h)
    assert not check_password("x", "nonsense")


def test_sign_up_sign_in_and_out(make_client):
    with make_client() as client:
        me = sign_up(client)
        assert me["email"] == "kev@example.com" and me["csrf"]
        cookie = client.cookies.get("bc_session")
        assert cookie
        assert client.get("/api/auth/me").json()["name"] == "Kev"
        # Sign out needs the CSRF token.
        del client.headers["X-CSRF-Token"]
        assert client.post("/api/auth/signout").status_code == 403
        client.headers["X-CSRF-Token"] = me["csrf"]
        assert client.post("/api/auth/signout").status_code == 200
        assert client.get("/api/auth/me").status_code == 401
        # The old cookie is dead on the server too.
        client.cookies.set("bc_session", cookie)
        assert client.get("/api/auth/me").status_code == 401
        r = client.post("/api/auth/signin", json={"email": "KEV@example.com", "password": "correct horse"})
        assert r.status_code == 200
        assert "httponly" in r.headers["set-cookie"].lower() and "samesite=lax" in r.headers["set-cookie"].lower()


def test_cookie_is_secure_in_production(make_client):
    with make_client(env="production", secret_key="x") as client:
        r = client.post("/api/auth/signup", json={"email": "a@b.co", "name": "A", "password": "password1"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_sign_up_refuses_duplicates_and_bad_input(make_client):
    with make_client() as client:
        sign_up(client)
        r = client.post("/api/auth/signup", json={"email": "kev@example.com", "name": "K", "password": "password1"})
        assert r.status_code == 409 and "already" in r.json()["detail"]
        assert client.post("/api/auth/signup", json={"email": "nope", "name": "K", "password": "password1"}).status_code == 422
        assert client.post("/api/auth/signup", json={"email": "a@b.co", "name": "K", "password": "short"}).status_code == 422


def test_failed_sign_ins_are_limited(make_client):
    with make_client() as client:
        sign_up(client)
        client.cookies.clear()
        for _ in range(10):
            r = client.post("/api/auth/signin", json={"email": "kev@example.com", "password": "wrong"})
            assert r.status_code == 401
            assert r.json()["detail"] == "That email and password don't match."
        r = client.post("/api/auth/signin", json={"email": "kev@example.com", "password": "correct horse"})
        assert r.status_code == 429 and "Wait" in r.json()["detail"]


def test_account_changes(user):
    assert user.patch("/api/auth/me", json={"name": "Kevin", "theme": "holodeck"}).json()["theme"] == "holodeck"
    assert user.get("/api/auth/me").json()["name"] == "Kevin"
    r = user.patch("/api/auth/me", json={"password": "new password", "current_password": "wrong"})
    assert r.status_code == 400
    assert user.patch("/api/auth/me", json={"password": "new password", "current_password": "correct horse"}).status_code == 200
    user.post("/api/auth/signout")
    r = user.post("/api/auth/signin", json={"email": "kev@example.com", "password": "new password"})
    assert r.status_code == 200


def test_delete_account(user):
    user.headers["X-CSRF-Token"] = user.get("/api/auth/me").json()["csrf"]
    user.put("/api/blobs/abcdef123456", content=b"solid x")
    assert user.delete("/api/auth/me").status_code == 200
    assert user.get("/api/auth/me").status_code == 401
    r = user.post("/api/auth/signin", json={"email": "kev@example.com", "password": "correct horse"})
    assert r.status_code == 401
