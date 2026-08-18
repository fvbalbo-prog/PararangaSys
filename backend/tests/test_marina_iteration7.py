"""Iteration 7 backend tests: staff login, users exclusion, complete endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="module")
def s():
    ss = requests.Session()
    ss.headers.update({"Content-Type": "application/json"})
    return ss


# ---------- Login by 5-digit CPF prefix ----------
class TestLoginPrefix:
    def test_login_staff_prefix(self, s):
        r = s.post(f"{BASE_URL}/api/login", json={"cpf": "55555"})
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["is_staff"] is True
        assert u.get("is_admin") is False
        assert u["cpf"] == "55555555555"

    def test_login_admin_prefix(self, s):
        r = s.post(f"{BASE_URL}/api/login", json={"cpf": "00000"})
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["is_admin"] is True

    def test_login_client_prefix(self, s):
        r = s.post(f"{BASE_URL}/api/login", json={"cpf": "11111"})
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["name"].startswith("João")
        assert not u.get("is_admin")
        assert not u.get("is_staff")

    def test_login_short_cpf_rejected(self, s):
        r = s.post(f"{BASE_URL}/api/login", json={"cpf": "111"})
        assert r.status_code == 400

    def test_login_not_found(self, s):
        r = s.post(f"{BASE_URL}/api/login", json={"cpf": "98765"})
        assert r.status_code == 404


# ---------- GET /api/users excludes admin AND staff ----------
class TestUsersExclusion:
    def test_users_excludes_admin_and_staff(self, s):
        r = s.get(f"{BASE_URL}/api/users")
        assert r.status_code == 200
        users = r.json()
        cpfs = [u["cpf"] for u in users]
        assert "00000000000" not in cpfs
        assert "55555555555" not in cpfs
        # regular clients still present
        for c in ("11111111111", "22222222222", "33333333333"):
            assert c in cpfs

    def test_user_boats_are_objects_with_length(self, s):
        r = s.get(f"{BASE_URL}/api/users")
        users = {u["cpf"]: u for u in r.json()}
        carlos = users["33333333333"]
        aurora = next(b for b in carlos["boats"] if b["name"] == "Aurora")
        assert aurora["length"] == 34


# ---------- PATCH /api/requests/{id}/complete ----------
class TestComplete:
    def test_complete_lifecycle(self, s):
        # Create a subida for today
        from datetime import datetime
        today = datetime.now().strftime("%Y-%m-%d")
        payload = {
            "type": "subida",
            "cpf": "11111111111",
            "date": today,
            "time": "17:30",  # unlimited slot, safe
            "boat_name": "Netuno",
            "observation": "TEST_iter7",
        }
        r = s.post(f"{BASE_URL}/api/requests", json=payload)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        try:
            r2 = s.patch(f"{BASE_URL}/api/requests/{rid}/complete")
            assert r2.status_code == 200, r2.text
            body = r2.json()
            assert body["status"] == "concluida"
            assert body.get("returned_at")
            # verify persistence
            r3 = s.get(f"{BASE_URL}/api/requests/{rid}")
            assert r3.json()["status"] == "concluida"
        finally:
            s.delete(f"{BASE_URL}/api/requests/{rid}")

    def test_complete_missing_returns_404(self, s):
        r = s.patch(f"{BASE_URL}/api/requests/does-not-exist/complete")
        assert r.status_code == 404


# ---------- Tide endpoint sanity (needed for banner) ----------
class TestTides:
    def test_tides_today_returns_points(self, s):
        from datetime import datetime
        today = datetime.now().strftime("%Y-%m-%d")
        r = s.get(f"{BASE_URL}/api/tides/{today}")
        assert r.status_code == 200
        body = r.json()
        assert body["date"] == today
        # points may be empty if anonymous throttled, but should be a list
        assert isinstance(body["points"], list)
