"""Iteration 9.1 backend tests: product stock (in_stock) toggling & order rejection.
Also lightweight regression: login, requests, convenience orders, authorizations, emergencies.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://lancha-scheduler.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CLIENT_CPF = "11111111111"
ADMIN_CPF = "00000000000"
STAFF_CPF = "55555555555"


@pytest.fixture(scope="module")
def s():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


# ===================== Products: in_stock field & filtering =====================
class TestStock:
    pid = None

    def test_seeded_products_expose_in_stock(self, s):
        r = s.get(f"{API}/products")
        assert r.status_code == 200
        prods = r.json()
        assert len(prods) >= 6
        for p in prods:
            assert "in_stock" in p, f"in_stock missing on {p}"
            assert p["in_stock"] is True

    def test_create_and_toggle_out_of_stock(self, s):
        r = s.post(f"{API}/products", json={"name": "TEST_iter91_prod", "price": 3.5})
        assert r.status_code == 200
        p = r.json()
        assert p["in_stock"] is True and p["active"] is True
        TestStock.pid = p["id"]

        # Mark out of stock
        r = s.put(f"{API}/products/{TestStock.pid}", json={"in_stock": False})
        assert r.status_code == 200 and r.json()["in_stock"] is False

        # Still active -> still appears in GET /products (list_active does not filter by stock)
        prods = s.get(f"{API}/products").json()
        found = next((x for x in prods if x["id"] == TestStock.pid), None)
        assert found is not None and found["in_stock"] is False

    def test_order_rejected_when_out_of_stock(self, s):
        assert TestStock.pid
        payload = {
            "cpf": CLIENT_CPF,
            "items": [{"product_id": TestStock.pid, "name": "TEST_iter91_prod", "price": 3.5, "qty": 1}],
        }
        r = s.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 400
        assert "estoque" in r.json().get("detail", "").lower()

    def test_order_rejected_when_inactive(self, s):
        assert TestStock.pid
        # restore stock, then deactivate
        assert s.put(f"{API}/products/{TestStock.pid}", json={"in_stock": True}).status_code == 200
        assert s.put(f"{API}/products/{TestStock.pid}", json={"active": False}).status_code == 200
        payload = {
            "cpf": CLIENT_CPF,
            "items": [{"product_id": TestStock.pid, "name": "TEST_iter91_prod", "price": 3.5, "qty": 1}],
        }
        r = s.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 400
        assert "indispon" in r.json().get("detail", "").lower()

    def test_all_flag_includes_inactive(self, s):
        assert TestStock.pid
        active = s.get(f"{API}/products").json()
        assert not any(p["id"] == TestStock.pid for p in active)
        all_ = s.get(f"{API}/products", params={"all": "true"}).json()
        assert any(p["id"] == TestStock.pid for p in all_)

    def test_restore_and_order_ok(self, s):
        assert TestStock.pid
        # Re-activate and in_stock
        assert s.put(f"{API}/products/{TestStock.pid}", json={"active": True, "in_stock": True}).status_code == 200
        payload = {
            "cpf": CLIENT_CPF,
            "items": [{"product_id": TestStock.pid, "name": "TEST_iter91_prod", "price": 3.5, "qty": 2}],
        }
        r = s.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["total"] == 7.0 and o["status"] == "pendente"

    def test_cleanup(self, s):
        if TestStock.pid:
            s.delete(f"{API}/products/{TestStock.pid}")


# ===================== Regression =====================
class TestRegression:
    def test_login_client(self, s):
        r = s.post(f"{API}/login", json={"cpf": "11111", "phone": "1111"})
        assert r.status_code == 200 and r.json()["cpf"] == CLIENT_CPF

    def test_login_admin(self, s):
        r = s.post(f"{API}/login", json={"cpf": "00000", "phone": "0000"})
        assert r.status_code == 200 and r.json().get("is_admin") is True

    def test_login_staff(self, s):
        r = s.post(f"{API}/login", json={"cpf": "55555", "phone": "0055"})
        assert r.status_code == 200 and r.json().get("is_staff") is True

    def test_requests_lifecycle(self, s):
        r = s.post(f"{API}/requests", json={
            "type": "subida", "cpf": CLIENT_CPF, "date": "2026-08-20", "time": "17:30"
        })
        assert r.status_code == 200
        rid = r.json()["id"]
        assert s.get(f"{API}/requests/{rid}").status_code == 200
        assert s.delete(f"{API}/requests/{rid}").status_code == 200

    def test_convenience_list(self, s):
        r = s.get(f"{API}/convenience/orders", params={"cpf": CLIENT_CPF})
        assert r.status_code == 200

    def test_authorization_today_lifecycle(self, s):
        today = datetime.now().strftime("%Y-%m-%d")
        r = s.post(f"{API}/authorizations", json={
            "cpf": CLIENT_CPF, "boat_name": "Netuno",
            "person_name": "TEST_iter91_auth_hoje", "date": today
        })
        assert r.status_code == 200
        a = r.json()
        assert a["status"] == "ativa" and a["date"] == today
        aid = a["id"]
        # verify appears in list
        lst = s.get(f"{API}/authorizations", params={"cpf": CLIENT_CPF}).json()
        assert any(x["id"] == aid for x in lst)
        # cancel + cleanup
        assert s.patch(f"{API}/authorizations/{aid}/cancel").status_code == 200

    def test_emergencies_open_available(self, s):
        # Ensure at least one open emergency exists for staff banner testing
        r = s.get(f"{API}/emergencies", params={"status": "aberta"})
        assert r.status_code == 200
        # Create one to guarantee presence for downstream frontend test
        c = s.post(f"{API}/emergencies", json={
            "cpf": CLIENT_CPF, "boat_name": "Netuno",
            "location": "TEST_iter91", "observation": "TEST_iter91"
        })
        assert c.status_code == 200 and c.json()["status"] == "aberta"
