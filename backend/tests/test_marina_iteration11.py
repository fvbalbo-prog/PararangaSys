"""Iteration 11 backend tests: scheduling window, authorization can_lower+service,
soft-delete users, reboque GPS quote, statements, monthly report cpf filter, regression."""
import os
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://lancha-scheduler.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
BR = timezone(timedelta(hours=-3))


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- helpers ----------
def _tomorrow_iso():
    return (datetime.now(BR).date() + timedelta(days=1)).isoformat()


def _today_iso():
    return datetime.now(BR).date().isoformat()


def _far_iso():
    return (datetime.now(BR).date() + timedelta(days=7)).isoformat()


# ---------- Scheduling window ----------
class TestSchedulingWindow:
    def test_reject_beyond_tomorrow(self, s):
        r = s.post(f"{API}/requests", json={
            "type": "subida", "cpf": "11111111111",
            "date": _far_iso(), "time": "10:00",
        })
        assert r.status_code == 400
        assert "hoje ou amanhã" in r.json()["detail"].lower() or "hoje ou amanha" in r.json()["detail"].lower()

    def test_reject_less_than_1h_today(self, s):
        now = datetime.now(BR)
        # Round current time to nearest half hour within 30 min from now => <1h
        m = now.minute
        # Pick the next half-hour slot (0 or 30) that's within 1h
        candidate = now + timedelta(minutes=20)
        # Round to half-hour
        cand_m = 0 if candidate.minute < 30 else 30
        cand_h = candidate.hour
        # Ensure within descida range 08:30-17:00 and clearly <1h
        if cand_h < 8 or cand_h > 17:
            pytest.skip("Outside descida window; cannot deterministically test <1h now.")
        hhmm = f"{cand_h:02d}:{cand_m:02d}"
        r = s.post(f"{API}/requests", json={
            "type": "subida", "cpf": "11111111111",
            "date": _today_iso(), "time": hhmm,
        })
        # Must be 400 with "1 hora"
        assert r.status_code == 400
        assert "1 hora" in r.json()["detail"]

    def test_valid_tomorrow(self, s):
        r = s.post(f"{API}/requests", json={
            "type": "subida", "cpf": "11111111111",
            "date": _tomorrow_iso(), "time": "10:00",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"]
        # cleanup
        s.delete(f"{API}/requests/{data['id']}")


# ---------- Authorization can_lower + service ----------
class TestAuthorizationsExtra:
    def test_create_with_can_lower_service(self, s):
        r = s.post(f"{API}/authorizations", json={
            "cpf": "11111111111",
            "boat_name": "Netuno",
            "person_name": "TEST_Iter11 Autorizado",
            "date": _tomorrow_iso(),
            "can_lower": True,
            "service": "Limpeza",
        })
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["can_lower"] is True
        assert doc["service"] == "Limpeza"
        aid = doc["id"]
        # GET list should contain fields
        r2 = s.get(f"{API}/authorizations?cpf=11111111111")
        assert r2.status_code == 200
        found = next((a for a in r2.json() if a["id"] == aid), None)
        assert found and found["can_lower"] is True and found["service"] == "Limpeza"
        # checkin then cancel
        r3 = s.patch(f"{API}/authorizations/{aid}/checkin")
        assert r3.status_code == 200 and r3.json()["entered_at"]
        r4 = s.patch(f"{API}/authorizations/{aid}/cancel")
        assert r4.status_code == 200 and r4.json()["status"] == "cancelada"


# ---------- Soft delete users ----------
class TestSoftDeleteUser:
    CPF = "33333333333"  # Carlos - deactivate then restore

    def test_users_include_active_flag(self, s):
        r = s.get(f"{API}/users")
        assert r.status_code == 200
        users = r.json()
        for u in users:
            assert "active" in u

    def test_deactivate_login_forbidden(self, s):
        r = s.patch(f"{API}/users/{self.CPF}/active", json={"active": False})
        assert r.status_code == 200 and r.json()["active"] is False
        # try login → 403
        r2 = s.post(f"{API}/login", json={"cpf": "33333", "phone": "3333"})
        assert r2.status_code == 403

    def test_reactivate_login_ok(self, s):
        r = s.patch(f"{API}/users/{self.CPF}/active", json={"active": True})
        assert r.status_code == 200 and r.json()["active"] is True
        r2 = s.post(f"{API}/login", json={"cpf": "33333", "phone": "3333"})
        assert r2.status_code == 200 and r2.json()["cpf"] == self.CPF


# ---------- Reboque GPS ----------
class TestReboqueGPS:
    def test_quote_via_coords(self, s):
        # Use marina coords + 0.05 lat offset (~3 nm)
        marina_lat = -27.5969
        marina_lng = -48.5495
        r = s.get(f"{API}/reboque/quote", params={
            "length": 22, "client_lat": marina_lat + 0.05, "client_lng": marina_lng,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["distance_nm"] > 0
        assert data["estimated_total"] >= 1200  # up to 25ft bucket base

    def test_post_reboque_with_gps(self, s):
        r = s.post(f"{API}/reboque", json={
            "cpf": "11111111111",
            "boat_name": "Netuno",
            "client_lat": -27.65,
            "client_lng": -48.55,
            "location": "TEST_Iter11 GPS",
        })
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["kind"] == "reboque"
        assert doc["distance_nm"] > 0
        assert doc["estimated_total"] > 0
        # cleanup: resolve
        s.patch(f"{API}/emergencies/{doc['id']}/resolve")


# ---------- Statements ----------
class TestStatements:
    MONTH = datetime.now(BR).strftime("%Y-%m")
    CPF = "11111111111"

    def test_send_statement(self, s):
        r = s.post(f"{API}/statements/send", json={"cpf": self.CPF, "month": self.MONTH})
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["month"] == self.MONTH
        assert "total" in doc and "convenience_total" in doc and "reboque_total" in doc
        assert doc["read"] is False

    def test_list_and_read(self, s):
        r = s.get(f"{API}/statements", params={"cpf": self.CPF})
        assert r.status_code == 200
        items = r.json()
        assert any(x["month"] == self.MONTH for x in items)
        sid = items[0]["id"]
        r2 = s.patch(f"{API}/statements/{sid}/read")
        assert r2.status_code == 200


# ---------- Report cpf filter ----------
class TestReportCpfFilter:
    def test_consumo_cpf_filter(self, s):
        month = datetime.now(BR).strftime("%Y-%m")
        r = s.get(f"{API}/reports/consumo", params={"month": month, "cpf": "11111111111"})
        assert r.status_code == 200
        data = r.json()
        assert data["month"] == month
        for c in data["clients"]:
            assert c["cpf"] == "11111111111"


# ---------- Regression ----------
class TestRegression:
    @pytest.mark.parametrize("cpf,phone", [
        ("00000", "0000"),  # admin
        ("55555", "0055"),  # staff
        ("11111", "1111"),  # cliente
    ])
    def test_login(self, s, cpf, phone):
        r = s.post(f"{API}/login", json={"cpf": cpf, "phone": phone})
        assert r.status_code == 200, r.text

    def test_products(self, s):
        r = s.get(f"{API}/products")
        assert r.status_code == 200 and len(r.json()) > 0

    def test_today_requests(self, s):
        r = s.get(f"{API}/requests/today")
        assert r.status_code == 200

    def test_convenience_orders_list(self, s):
        r = s.get(f"{API}/convenience/orders")
        assert r.status_code == 200

    def test_emergencies_list(self, s):
        r = s.get(f"{API}/emergencies")
        assert r.status_code == 200
