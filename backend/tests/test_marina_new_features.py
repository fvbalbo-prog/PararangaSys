"""Marina Pararanga - Tests for new features (admin, history, day, cancel, confirm-return)."""
import os
from datetime import datetime
import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"
TODAY = datetime.now().strftime("%Y-%m-%d")


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _create_descida(client, cpf="11111111111", time_="10:30"):
    payload = {
        "type": "descida", "cpf": cpf,
        "date": TODAY, "time": time_,
        "expected_return_date": TODAY, "expected_return_time": "16:00",
        "destination": "TEST_Cancel", "passengers": 3,
        "responsible": "TEST_Resp"
    }
    r = client.post(f"{API}/requests", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _create_subida(client, cpf="22222222222", time_="15:30"):
    r = client.post(f"{API}/requests", json={
        "type": "subida", "cpf": cpf, "date": TODAY, "time": time_
    })
    assert r.status_code == 200, r.text
    return r.json()


# ---- Admin login ----
class TestAdminLogin:
    def test_admin_login_flag(self, client):
        r = client.post(f"{API}/login", json={"cpf": "00000000000"})
        assert r.status_code == 200
        d = r.json()
        assert d["is_admin"] is True
        assert d["name"] == "Administração Marina"

    def test_regular_login_not_admin(self, client):
        r = client.post(f"{API}/login", json={"cpf": "11111111111"})
        assert r.status_code == 200
        assert r.json().get("is_admin", False) is False


# ---- Cancel request ----
class TestCancel:
    def test_cancel_marks_cancelada(self, client):
        req = _create_descida(client, time_="11:00")
        rid = req["id"]
        r = client.patch(f"{API}/requests/{rid}/cancel")
        assert r.status_code == 200
        assert r.json()["status"] == "cancelada"
        # Verify persisted
        g = client.get(f"{API}/requests/{rid}")
        assert g.json()["status"] == "cancelada"

    def test_cancel_not_found(self, client):
        r = client.patch(f"{API}/requests/does-not-exist/cancel")
        assert r.status_code == 404


# ---- Confirm return ----
class TestConfirmReturn:
    def test_confirm_return_marks_concluida(self, client):
        req = _create_descida(client, time_="11:30")
        rid = req["id"]
        r = client.patch(f"{API}/requests/{rid}/confirm-return")
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "concluida"
        assert d["returned_at"] is not None
        # Verify persisted
        g = client.get(f"{API}/requests/{rid}").json()
        assert g["status"] == "concluida"
        assert g["returned_at"]

    def test_confirm_return_not_found(self, client):
        r = client.patch(f"{API}/requests/nope/confirm-return")
        assert r.status_code == 404


# ---- History ----
class TestHistory:
    def test_history_returns_user_requests(self, client):
        req = _create_subida(client, cpf="33333333333", time_="14:00")
        r = client.get(f"{API}/requests/history?cpf=33333333333")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # Contains just-created one
        ids = [x["id"] for x in data]
        assert req["id"] in ids
        # All belong to same cpf
        assert all(x["cpf"] == "33333333333" for x in data)

    def test_history_formatted_cpf(self, client):
        r = client.get(f"{API}/requests/history?cpf=333.333.333-33")
        assert r.status_code == 200


# ---- Day requests (admin panel) ----
class TestDayRequests:
    def test_day_default_today(self, client):
        req = _create_descida(client, time_="12:00")
        r = client.get(f"{API}/requests/day")
        assert r.status_code == 200
        data = r.json()
        assert all(x["date"] == TODAY for x in data)
        assert req["id"] in [x["id"] for x in data]

    def test_day_specific_date(self, client):
        r = client.get(f"{API}/requests/day?date={TODAY}")
        assert r.status_code == 200
        assert all(x["date"] == TODAY for x in r.json())

    def test_day_filter_by_type(self, client):
        r = client.get(f"{API}/requests/day?type=descida&date={TODAY}")
        assert r.status_code == 200
        assert all(x["type"] == "descida" for x in r.json())

    def test_day_past_date_empty_or_valid(self, client):
        # An arbitrary past date should return an empty list (no requests)
        r = client.get(f"{API}/requests/day?date=2020-01-01")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
