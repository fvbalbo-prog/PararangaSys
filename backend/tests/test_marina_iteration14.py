"""
Iteration 14 backend tests — Marina Pararanga.
Covers: conveniência (list orders per cpf), reboque quote via GPS, dayRequests
returns type-mixed items filterable by client, authorizations list valid-today.
"""
import os
import pytest
import requests
from datetime import datetime

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "https://lancha-scheduler.preview.emergentagent.com").rstrip("/")
JOAO_CPF = "11111111111"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Convenience --- ----------------------------------------------------------

class TestConvenienceOrders:
    def test_list_products_ok(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        assert "id" in data[0] and "price" in data[0]

    def test_create_order_and_todays_orders_present(self, api_client):
        # Pick a product currently in stock
        prods = api_client.get(f"{BASE_URL}/api/products").json()
        chosen = next((p for p in prods if p.get("in_stock") is not False and p.get("active") is not False), None)
        assert chosen is not None, "No available product to order"

        payload = {
            "cpf": JOAO_CPF,
            "boat_name": "Netuno",
            "items": [{"product_id": chosen["id"], "name": chosen["name"], "price": chosen["price"], "qty": 1}],
            "observation": "TEST_iter14 order",
        }
        r = api_client.post(f"{BASE_URL}/api/convenience/orders", json=payload)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["cpf"] == JOAO_CPF
        assert order["status"] == "pendente"
        assert order["total"] == round(chosen["price"] * 1, 2)
        assert "created_at" in order

        # today's ISO date prefix
        today = datetime.utcnow().date().isoformat()
        assert order["created_at"].startswith(today), f"Order created_at should start with today {today}, got {order['created_at']}"

        # GET verifies persistence + presence in today's set
        r = api_client.get(f"{BASE_URL}/api/convenience/orders?cpf={JOAO_CPF}")
        assert r.status_code == 200
        orders = r.json()
        ids = [o["id"] for o in orders]
        assert order["id"] in ids
        todays = [o for o in orders if (o.get("created_at") or "").startswith(today)]
        assert order["id"] in [o["id"] for o in todays]


# --- Reboque quote via GPS ----------------------------------------------------

class TestReboqueQuote:
    def test_quote_with_coords(self, api_client):
        # Coordinates ~ 3 nm away from marina (Florianópolis area)
        r = api_client.get(
            f"{BASE_URL}/api/reboque/quote",
            params={"length": 24, "client_lat": -27.5, "client_lng": -48.5},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("distance_nm", "base_fee", "additional_nm", "additional_fee", "per_nm", "estimated_total"):
            assert k in data, f"missing {k}"
        assert data["distance_nm"] >= 0
        assert data["estimated_total"] >= data["base_fee"]

    def test_quote_missing_params(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/reboque/quote", params={"length": 20})
        assert r.status_code == 400


# --- Day requests (staff filter source) --------------------------------------

class TestDayRequests:
    def test_day_requests_returns_list(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/requests/day")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # every item must have id/type/status/time
        for it in data:
            assert it["type"] in ("descida", "subida")
            assert "status" in it and "time" in it and "id" in it

    def test_day_requests_filter_descida(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/requests/day", params={"type": "descida"})
        assert r.status_code == 200
        for it in r.json():
            assert it["type"] == "descida"

    def test_day_requests_filter_subida(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/requests/day", params={"type": "subida"})
        assert r.status_code == 200
        for it in r.json():
            assert it["type"] == "subida"


# --- Authorizations (staff view) ---------------------------------------------

class TestAuthorizationsList:
    def test_list_authorizations_ok(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/authorizations")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # Each row (if any) must have required keys used by /staff-autorizacoes
        for a in data:
            for k in ("id", "person_name", "boat_name", "user_name", "status"):
                assert k in a
