"""Iteration 8 tests: cpf5 + phone4 login, /reopen endpoint, regression."""
import os
from datetime import datetime
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Login (cpf5 + phone4) ----------
class TestLogin:
    def test_login_joao_ok(self, s):
        r = s.post(f"{API}/login", json={"cpf": "11111", "phone": "1111"})
        assert r.status_code == 200
        d = r.json()
        assert d["cpf"] == "11111111111"
        assert d["name"].startswith("João")
        assert d.get("is_admin") is False
        assert d.get("is_staff", False) is False

    def test_login_admin_ok(self, s):
        r = s.post(f"{API}/login", json={"cpf": "00000", "phone": "0000"})
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_login_staff_ok(self, s):
        r = s.post(f"{API}/login", json={"cpf": "55555", "phone": "0055"})
        assert r.status_code == 200
        assert r.json()["is_staff"] is True

    def test_login_wrong_phone_404(self, s):
        r = s.post(f"{API}/login", json={"cpf": "11111", "phone": "9999"})
        assert r.status_code == 404

    def test_login_missing_phone_400(self, s):
        r = s.post(f"{API}/login", json={"cpf": "11111", "phone": "12"})
        assert r.status_code == 400

    def test_login_short_cpf_400(self, s):
        r = s.post(f"{API}/login", json={"cpf": "111", "phone": "1111"})
        assert r.status_code == 400

    def test_login_missing_phone_field_400(self, s):
        r = s.post(f"{API}/login", json={"cpf": "11111"})
        assert r.status_code == 400


# ---------- Reopen endpoint ----------
class TestReopen:
    created_id = None

    def _create_subida(self, s):
        payload = {
            "type": "subida",
            "cpf": "11111111111",
            "date": datetime.now().strftime("%Y-%m-%d"),
            "time": "17:30",  # unlimited slot
            "boat_name": "Netuno",
        }
        r = s.post(f"{API}/requests", json=payload)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_reopen_flow(self, s):
        rid = self._create_subida(s)
        try:
            # Complete it
            r = s.patch(f"{API}/requests/{rid}/complete")
            assert r.status_code == 200
            assert r.json()["status"] == "concluida"
            assert r.json()["returned_at"] is not None

            # Reopen
            r = s.patch(f"{API}/requests/{rid}/reopen")
            assert r.status_code == 200
            body = r.json()
            assert body["status"] == "agendada"
            assert body.get("returned_at") in (None, "")

            # Verify via GET
            r = s.get(f"{API}/requests/{rid}")
            assert r.status_code == 200
            assert r.json()["status"] == "agendada"
            assert r.json().get("returned_at") in (None, "")
        finally:
            s.delete(f"{API}/requests/{rid}")

    def test_reopen_unknown_404(self, s):
        r = s.patch(f"{API}/requests/does-not-exist/reopen")
        assert r.status_code == 404


# ---------- Regression: capacity + tides + admin flows ----------
class TestRegression:
    def test_slots_descida_shape(self, s):
        today = datetime.now().strftime("%Y-%m-%d")
        r = s.get(f"{API}/slots", params={"type": "descida", "date": today})
        assert r.status_code == 200
        slots = r.json()
        assert any(x["time"] == "08:30" for x in slots)
        assert all("available" in x for x in slots)

    def test_tides(self, s):
        today = datetime.now().strftime("%Y-%m-%d")
        r = s.get(f"{API}/tides/{today}")
        assert r.status_code == 200
        assert r.json()["harbor"] == "sp01"

    def test_users_excludes_admin_and_staff(self, s):
        r = s.get(f"{API}/users")
        assert r.status_code == 200
        cpfs = {u["cpf"] for u in r.json()}
        assert "00000000000" not in cpfs
        assert "55555555555" not in cpfs
        assert "11111111111" in cpfs

    def test_boats_add_remove(self, s):
        cpf = "22222222222"
        boat = "TEST_iter8_boat"
        # ensure clean
        s.delete(f"{API}/users/{cpf}/boats", params={"boat": boat})
        r = s.post(f"{API}/users/{cpf}/boats", json={"name": boat, "draft": 0.9, "length": 26})
        assert r.status_code == 200
        assert any(b["name"] == boat for b in r.json()["boats"])
        r = s.delete(f"{API}/users/{cpf}/boats", params={"boat": boat})
        assert r.status_code == 200
        assert all(b["name"] != boat for b in r.json()["boats"])
