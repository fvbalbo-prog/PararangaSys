"""Iteration 12 backend regression: emergências (create/cancel), conveniência,
reboque com coordenadas da marina (-23.7980368, -45.3986618), authorizations
checkin, statements notify, consumo report."""
import os
import re
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://lancha-scheduler.preview.emergentagent.com"
BASE = BASE.rstrip("/")
API = f"{BASE}/api"

CPF_JOAO = "11111111111"
CPF_ADMIN = "00000000000"

BR_TZ = timezone(timedelta(hours=-3))


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Login regression ----------
class TestLogin:
    def test_admin(self, s):
        r = s.post(f"{API}/login", json={"cpf": "00000", "phone": "0000"})
        assert r.status_code == 200
        assert r.json().get("is_admin") is True

    def test_staff(self, s):
        r = s.post(f"{API}/login", json={"cpf": "55555", "phone": "0055"})
        assert r.status_code == 200
        assert r.json().get("is_staff") is True

    def test_client_joao(self, s):
        r = s.post(f"{API}/login", json={"cpf": "11111", "phone": "1111"})
        assert r.status_code == 200
        j = r.json()
        assert j["cpf"] == CPF_JOAO


# ---------- Emergencies (create/list/cancel/resolve) ----------
class TestEmergencies:
    _eid = None

    def test_create_socorro(self, s):
        r = s.post(f"{API}/emergencies", json={"cpf": CPF_JOAO, "boat_name": "Netuno",
                                                "location": "TEST loc", "observation": "TEST"})
        assert r.status_code == 200
        d = r.json()
        assert d["kind"] == "socorro"
        assert d["status"] == "aberta"
        assert d["cpf"] == CPF_JOAO
        TestEmergencies._eid = d["id"]

    def test_list_has_emergency(self, s):
        r = s.get(f"{API}/emergencies", params={"cpf": CPF_JOAO})
        assert r.status_code == 200
        ids = [e["id"] for e in r.json()]
        assert TestEmergencies._eid in ids

    def test_cancel_emergency(self, s):
        eid = TestEmergencies._eid
        r = s.patch(f"{API}/emergencies/{eid}/cancel")
        assert r.status_code == 200
        assert r.json()["status"] == "cancelada"

    def test_cancel_unknown_404(self, s):
        r = s.patch(f"{API}/emergencies/does-not-exist/cancel")
        assert r.status_code == 404

    def test_resolve_new(self, s):
        r = s.post(f"{API}/emergencies", json={"cpf": CPF_JOAO, "boat_name": "Netuno"})
        eid = r.json()["id"]
        r2 = s.patch(f"{API}/emergencies/{eid}/resolve")
        assert r2.status_code == 200
        assert r2.json()["status"] == "atendida"


# ---------- Reboque with marina coordinates ----------
class TestReboque:
    def test_quote_marina_coords(self, s):
        # marina (-23.7980368, -45.3986618). Ponto client ~5 milhas
        r = s.get(f"{API}/reboque/quote",
                  params={"length": 22, "client_lat": -23.85, "client_lng": -45.4})
        assert r.status_code == 200
        d = r.json()
        assert "distance_nm" in d
        assert d["distance_nm"] > 0
        # Should be ~3-4 NM given coordinates
        assert d["distance_nm"] < 20
        assert d["estimated_total"] >= d["base_fee"]

    def test_quote_distance_only(self, s):
        r = s.get(f"{API}/reboque/quote", params={"length": 22, "distance": 10})
        assert r.status_code == 200
        d = r.json()
        assert d["distance_nm"] == 10.0
        assert d["additional_nm"] == 5.0

    def test_quote_no_input_400(self, s):
        r = s.get(f"{API}/reboque/quote", params={"length": 22})
        assert r.status_code == 400

    def test_create_reboque(self, s):
        r = s.post(f"{API}/reboque", json={"cpf": CPF_JOAO, "boat_name": "Netuno",
                                            "client_lat": -23.85, "client_lng": -45.4,
                                            "observation": "TEST reboque"})
        assert r.status_code == 200
        d = r.json()
        assert d["kind"] == "reboque"
        assert d["estimated_total"] > 0
        # cleanup: resolve
        s.patch(f"{API}/emergencies/{d['id']}/resolve")


# ---------- Conveniência orders ----------
class TestConvenience:
    def test_create_order(self, s):
        prods = s.get(f"{API}/products").json()
        assert len(prods) > 0
        p = prods[0]
        r = s.post(f"{API}/convenience/orders", json={
            "cpf": CPF_JOAO,
            "items": [{"product_id": p["id"], "name": p["name"], "price": p["price"], "qty": 2}],
            "observation": "TEST",
        })
        assert r.status_code == 200
        d = r.json()
        assert d["total"] == round(p["price"] * 2, 2)
        assert d["status"] == "pendente"

    def test_list_orders(self, s):
        r = s.get(f"{API}/convenience/orders", params={"cpf": CPF_JOAO})
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Authorizations + checkin ----------
class TestAuthorizations:
    def test_create_and_checkin(self, s):
        today = datetime.now(BR_TZ).strftime("%Y-%m-%d")
        r = s.post(f"{API}/authorizations", json={
            "cpf": CPF_JOAO, "boat_name": "Netuno",
            "person_name": "TEST Autorizado",
            "date": today, "can_lower": False, "service": "Limpeza"
        })
        assert r.status_code == 200
        aid = r.json()["id"]
        assert r.json()["entered_at"] is None

        r2 = s.patch(f"{API}/authorizations/{aid}/checkin")
        assert r2.status_code == 200
        d = r2.json()
        assert d["entered_at"] is not None
        # ISO 8601 UTC
        assert re.match(r"^\d{4}-\d{2}-\d{2}T", d["entered_at"])

        # verify via GET
        r3 = s.get(f"{API}/authorizations", params={"cpf": CPF_JOAO})
        found = [a for a in r3.json() if a["id"] == aid][0]
        assert found["entered_at"] is not None

        # cleanup
        s.patch(f"{API}/authorizations/{aid}/cancel")


# ---------- Statements / consumo ----------
class TestStatements:
    _sid = None

    def test_send_statement(self, s):
        month = datetime.now(BR_TZ).strftime("%Y-%m")
        r = s.post(f"{API}/statements/send", json={"cpf": CPF_JOAO, "month": month})
        assert r.status_code == 200
        d = r.json()
        assert d["cpf"] == CPF_JOAO
        assert d["month"] == month
        assert d["read"] is False
        TestStatements._sid = d["id"]

    def test_list_statement_unread(self, s):
        r = s.get(f"{API}/statements", params={"cpf": CPF_JOAO})
        assert r.status_code == 200
        docs = r.json()
        me = [x for x in docs if x["id"] == TestStatements._sid]
        assert len(me) == 1
        assert me[0]["read"] is False

    def test_read_statement(self, s):
        r = s.patch(f"{API}/statements/{TestStatements._sid}/read")
        assert r.status_code == 200
        # verify
        docs = s.get(f"{API}/statements", params={"cpf": CPF_JOAO}).json()
        me = [x for x in docs if x["id"] == TestStatements._sid][0]
        assert me["read"] is True


class TestConsumo:
    def test_consumo(self, s):
        month = datetime.now(BR_TZ).strftime("%Y-%m")
        r = s.get(f"{API}/reports/consumo", params={"month": month})
        assert r.status_code == 200
        d = r.json()
        assert d["month"] == month
        assert "grand_total" in d
        assert isinstance(d["clients"], list)


# ---------- Requests window (today/tomorrow + 1h) ----------
class TestRequestsWindow:
    def test_beyond_tomorrow_rejected(self, s):
        d = (datetime.now(BR_TZ) + timedelta(days=5)).date().isoformat()
        r = s.post(f"{API}/requests", json={
            "type": "subida", "cpf": CPF_JOAO, "date": d, "time": "10:00",
            "boat_name": "Netuno",
        })
        assert r.status_code == 400
        assert "hoje ou amanhã" in r.json()["detail"]

    def test_less_than_1h_rejected(self, s):
        now = datetime.now(BR_TZ)
        soon = now + timedelta(minutes=15)
        # snap to next :00 or :30
        minute = 0 if soon.minute < 30 else 30
        t = soon.replace(minute=minute, second=0, microsecond=0)
        r = s.post(f"{API}/requests", json={
            "type": "subida", "cpf": CPF_JOAO,
            "date": t.date().isoformat(),
            "time": t.strftime("%H:%M"),
            "boat_name": "Netuno",
        })
        # Either 400 (1h) or 400 (window). Either way, not created.
        assert r.status_code == 400
