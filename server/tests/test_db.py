"""The one shared connection must survive the worker threads FastAPI runs sync routes and dependencies in."""

from concurrent.futures import ThreadPoolExecutor

from bettercad import db


def test_threads_can_share_the_connection(tmp_path):
    # Before the lock this failed at once with "bad parameter or other API misuse", as on the live site.
    conn = db.connect(tmp_path / "bettercad.db")
    db.migrate(conn)
    with conn:
        conn.execute("INSERT INTO accounts (id, name, last_seen) VALUES (1, 'kev', date('now'))")

    def work(n: int) -> int:
        for i in range(1500):
            row = conn.execute("SELECT name, last_seen = date('now') AS seen FROM accounts WHERE id = ?", (1,)).fetchone()
            assert row["name"] == "kev"
            if i % 50 == 0:
                with conn:
                    conn.execute("UPDATE accounts SET last_seen = date('now') WHERE id = ?", (1,))
        return n

    with ThreadPoolExecutor(8) as pool:
        assert sorted(pool.map(work, range(8))) == list(range(8))


def test_rows_act_like_a_cursor(tmp_path):
    conn = db.connect(tmp_path / "bettercad.db")
    conn.execute("CREATE TABLE t (x INTEGER)")
    cur = conn.executemany("INSERT INTO t VALUES (?)", [(1,), (2,), (3,)])
    assert cur.rowcount == 3
    assert conn.execute("INSERT INTO t VALUES (4)").lastrowid == 4
    rows = conn.execute("SELECT x FROM t ORDER BY x")
    assert rows.fetchone()["x"] == 1
    assert [r["x"] for r in rows] == [2, 3, 4]
    assert rows.fetchone() is None
    assert conn.execute("SELECT x FROM t WHERE x > 9").fetchone() is None


def test_concurrent_requests(user):
    # The live failure: GET /api/models alongside other signed-in requests, each running current_user in its own thread.
    paths = ["/api/models?top=true&sort=modified&limit=200", "/api/places", "/api/account"] * 40
    with ThreadPoolExecutor(12) as pool:
        codes = list(pool.map(lambda p: user.get(p).status_code, paths))
    assert codes == [200] * len(paths)
