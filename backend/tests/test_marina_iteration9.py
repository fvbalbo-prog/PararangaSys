"""Iteration 9 backend tests: products, convenience orders, authorizations, emergencies.
Also regression checks for existing endpoints (login, requests, tides, slots, users).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://lancha-scheduler.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CLIENT_CPF = "11111111111"          # João Silva (has 'Netuno')
ADMIN_CPF = "00000000000"
STAFF_CPF = "55555555555"
UNKNOWN_CPF = "99999999999"


@pytest.fixture(scope="module")
def s():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


# ===================== Regression: login, users, tides, slots, requests =====================
class TestRegression:
    def test_login_client(self, s):
        r = s.post(f"{API}/login", json={"cpf": "11111", "phone": "1111"})
        assert r.status_code == 200
        u = r.json()
        assert u["cpf"] == CLIENT_CPF and not u.get("is_admin") and not u.get("is_staff")

    def test_login_admin(self, s):
        r = s.post(f"{API}/login", json={"cpf": "00000", "phone": "0000"})
        assert r.status_code == 200 and r.json()["is_admin"] is True

    def test_login_staff(self, s):
        r = s.post(f"{API}/login", json={"cpf": "55555", "phone": "0055"})
        assert r.status_code == 200 and r.json()["is_staff"] is True

    def test_users_list_excludes_admin_staff(self, s):
        r = s.get(f"{API}/users")
        assert r.status_code == 200
        cpfs = [u["cpf"] for u in r.json()]
        assert ADMIN_CPF not in cpfs and STAFF_CPF not in cpfs

    def test_slots_endpoint(self, s):
        r = s.get(f"{API}/slots", params={"type": "subida", "date": "2026-08-20"})
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and any(x["time"] == "17:30" and x["unlimited"] for x in data)

    def test_tides_endpoint(self, s):
        r = s.get(f"{API}/tides/2026-08-20")
        assert r.status_code == 200
        assert r.json().get("harbor") == "sp01"

    def test_requests_create_cancel_lifecycle(self, s):
        # unlimited slot 17:30 subida
        payload = {"type": "subida", "cpf": CLIENT_CPF, "date": "2026-08-20", "time": "17:30"}
        r = s.post(f"{API}/requests", json=payload)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        # GET to confirm persistence
        g = s.get(f"{API}/requests/{rid}")
        assert g.status_code == 200 and g.json()["status"] == "agendada"
        # cleanup
        d = s.delete(f"{API}/requests/{rid}")
        assert d.status_code == 200


# ===================== Products =====================
class TestProducts:
    created_id = None

    def test_list_active(self, s):
        r = s.get(f"{API}/products")
        assert r.status_code == 200
        prods = r.json()
        assert isinstance(prods, list) and len(prods) >= 6  # 6 seeded
        for p in prods:
            assert p.get("active", True) is True
            assert "id" in p and "name" in p and "price" in p

    def test_list_all_includes_inactive(self, s):
        r = s.get(f"{API}/products", params={"all": "true"})
        assert r.status_code == 200

    def test_create_product(self, s):
        payload = {"name": "TEST_Produto_Iter9", "price": 9.99}
        r = s.post(f"{API}/products", json=payload)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["name"] == "TEST_Produto_Iter9" and p["price"] == 9.99 and p["active"] is True
        TestProducts.created_id = p["id"]

    def test_update_toggle_active(self, s):
        assert TestProducts.created_id
        r = s.put(f"{API}/products/{TestProducts.created_id}", json={"active": False})
        assert r.status_code == 200 and r.json()["active"] is False
        # verify by listing active only — should not be in active list
        active = s.get(f"{API}/products").json()
        assert not any(p["id"] == TestProducts.created_id for p in active)
        # but is in all
        all_ = s.get(f"{API}/products", params={"all": "true"}).json()
        assert any(p["id"] == TestProducts.created_id for p in all_)

    def test_update_name_price(self, s):
        assert TestProducts.created_id
        r = s.put(f"{API}/products/{TestProducts.created_id}", json={"name": "TEST_Renamed", "price": 12.5})
        assert r.status_code == 200
        p = r.json()
        assert p["name"] == "TEST_Renamed" and p["price"] == 12.5

    def test_update_not_found(self, s):
        r = s.put(f"{API}/products/{uuid.uuid4()}", json={"active": True})
        assert r.status_code == 404

    def test_delete_product(self, s):
        assert TestProducts.created_id
        r = s.delete(f"{API}/products/{TestProducts.created_id}")
        assert r.status_code == 200
        # deleting again -> 404
        r2 = s.delete(f"{API}/products/{TestProducts.created_id}")
        assert r2.status_code == 404


# ===================== Convenience orders =====================
class TestOrders:
    order_id = None

    def _pick_two_products(self, s):
        prods = s.get(f"{API}/products").json()
        assert len(prods) >= 2
        return prods[:2]

    def test_create_order_ok(self, s):
        p1, p2 = self._pick_two_products(s)
        payload = {
            "cpf": CLIENT_CPF,
            "boat_name": "Netuno",
            "items": [
                {"product_id": p1["id"], "name": p1["name"], "price": p1["price"], "qty": 2},
                {"product_id": p2["id"], "name": p2["name"], "price": p2["price"], "qty": 1},
            ],
            "observation": "TEST_iter9 obs",
        }
        expected_total = round(p1["price"] * 2 + p2["price"] * 1, 2)
        r = s.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["total"] == expected_total
        assert o["status"] == "pendente"
        assert o["user_name"] == "João Silva"
        assert o["boat_name"] == "Netuno"
        assert len(o["items"]) == 2
        TestOrders.order_id = o["id"]

    def test_create_order_unknown_cpf(self, s):
        p1 = s.get(f"{API}/products").json()[0]
        payload = {
            "cpf": UNKNOWN_CPF, "items": [
                {"product_id": p1["id"], "name": p1["name"], "price": p1["price"], "qty": 1}
            ]
        }
        r = s.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 404

    def test_create_order_no_items(self, s):
        payload = {"cpf": CLIENT_CPF, "items": []}
        r = s.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 400

    def test_list_all_orders(self, s):
        r = s.get(f"{API}/convenience/orders")
        assert r.status_code == 200
        docs = r.json()
        assert any(d["id"] == TestOrders.order_id for d in docs)

    def test_list_orders_by_cpf(self, s):
        r = s.get(f"{API}/convenience/orders", params={"cpf": CLIENT_CPF})
        assert r.status_code == 200
        for d in r.json():
            assert d["cpf"] == CLIENT_CPF

    def test_patch_status_entregue(self, s):
        assert TestOrders.order_id
        r = s.patch(f"{API}/convenience/orders/{TestOrders.order_id}/status", params={"status": "entregue"})
        assert r.status_code == 200 and r.json()["status"] == "entregue"

    def test_patch_status_cancelada(self, s):
        r = s.patch(f"{API}/convenience/orders/{TestOrders.order_id}/status", params={"status": "cancelada"})
        assert r.status_code == 200 and r.json()["status"] == "cancelada"

    def test_patch_status_invalid(self, s):
        r = s.patch(f"{API}/convenience/orders/{TestOrders.order_id}/status", params={"status": "foo"})
        assert r.status_code == 400

    def test_patch_status_not_found(self, s):
        r = s.patch(f"{API}/convenience/orders/{uuid.uuid4()}/status", params={"status": "entregue"})
        assert r.status_code == 404


# ===================== Authorizations =====================
class TestAuthorizations:
    auth_id = None

    def test_create(self, s):
        payload = {
            "cpf": CLIENT_CPF,
            "boat_name": "Netuno",
            "person_name": "TEST_Autorizado Iter9",
            "date": "2026-09-05",
        }
        r = s.post(f"{API}/authorizations", json=payload)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["status"] == "ativa"
        assert a["user_name"] == "João Silva"
        assert a["person_name"] == "TEST_Autorizado Iter9"
        TestAuthorizations.auth_id = a["id"]

    def test_create_unknown_cpf(self, s):
        r = s.post(f"{API}/authorizations", json={
            "cpf": UNKNOWN_CPF, "boat_name": "X", "person_name": "Y", "date": "2026-09-05"
        })
        assert r.status_code == 404

    def test_create_blank_name(self, s):
        r = s.post(f"{API}/authorizations", json={
            "cpf": CLIENT_CPF, "boat_name": "Netuno", "person_name": "   ", "date": "2026-09-05"
        })
        assert r.status_code == 400

    def test_list_all(self, s):
        r = s.get(f"{API}/authorizations")
        assert r.status_code == 200
        assert any(a["id"] == TestAuthorizations.auth_id for a in r.json())

    def test_list_by_cpf(self, s):
        r = s.get(f"{API}/authorizations", params={"cpf": CLIENT_CPF})
        assert r.status_code == 200
        assert all(a["cpf"] == CLIENT_CPF for a in r.json())

    def test_cancel(self, s):
        r = s.patch(f"{API}/authorizations/{TestAuthorizations.auth_id}/cancel")
        assert r.status_code == 200 and r.json()["status"] == "cancelada"

    def test_cancel_not_found(self, s):
        r = s.patch(f"{API}/authorizations/{uuid.uuid4()}/cancel")
        assert r.status_code == 404


# ===================== Emergencies =====================
class TestEmergencies:
    eid = None

    def test_create(self, s):
        r = s.post(f"{API}/emergencies", json={
            "cpf": CLIENT_CPF, "boat_name": "Netuno",
            "location": "TEST_Ilha", "observation": "TEST_obs"
        })
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["status"] == "aberta"
        assert e["user_name"] == "João Silva"
        assert e["phone"] and e["boat_name"] == "Netuno"
        TestEmergencies.eid = e["id"]

    def test_create_unknown_cpf(self, s):
        r = s.post(f"{API}/emergencies", json={"cpf": UNKNOWN_CPF})
        assert r.status_code == 404

    def test_list_all(self, s):
        r = s.get(f"{API}/emergencies")
        assert r.status_code == 200
        assert any(e["id"] == TestEmergencies.eid for e in r.json())

    def test_list_by_cpf(self, s):
        r = s.get(f"{API}/emergencies", params={"cpf": CLIENT_CPF})
        assert r.status_code == 200
        assert all(e["cpf"] == CLIENT_CPF for e in r.json())

    def test_list_by_status(self, s):
        r = s.get(f"{API}/emergencies", params={"status": "aberta"})
        assert r.status_code == 200
        assert all(e["status"] == "aberta" for e in r.json())

    def test_resolve(self, s):
        r = s.patch(f"{API}/emergencies/{TestEmergencies.eid}/resolve")
        assert r.status_code == 200
        e = r.json()
        assert e["status"] == "atendida" and e["resolved_at"] is not None

    def test_resolve_not_found(self, s):
        r = s.patch(f"{API}/emergencies/{uuid.uuid4()}/resolve")
        assert r.status_code == 404
