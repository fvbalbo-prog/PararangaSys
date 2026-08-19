"""Backend tests for iteration 19 features:
- Convenience order with delivery_method (balcao / lancha)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://lancha-scheduler.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

CLIENT_CPF = "11111111111"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def sample_product(api_client):
    r = api_client.get(f"{API}/products")
    assert r.status_code == 200
    prods = r.json()
    assert len(prods) > 0, "Need seeded products"
    # pick first active in-stock
    for p in prods:
        if p.get("active", True) and p.get("in_stock", True):
            return p
    pytest.skip("No available product")


class TestHealth:
    def test_root(self, api_client):
        r = api_client.get(f"{API}/")
        assert r.status_code == 200


class TestConvenienceDelivery:
    """Feature: delivery_method persisted in convenience orders."""

    def test_create_order_delivery_lancha(self, api_client, sample_product):
        payload = {
            "cpf": CLIENT_CPF,
            "boat_name": "Netuno",
            "items": [{
                "product_id": sample_product["id"],
                "name": sample_product["name"],
                "price": sample_product["price"],
                "qty": 1,
            }],
            "observation": "TEST_delivery_lancha",
            "delivery_method": "lancha",
        }
        r = api_client.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["delivery_method"] == "lancha"
        assert data["cpf"] == CLIENT_CPF
        assert data["status"] == "pendente"
        # Verify persistence via list
        r2 = api_client.get(f"{API}/convenience/orders", params={"cpf": CLIENT_CPF})
        assert r2.status_code == 200
        found = [o for o in r2.json() if o["id"] == data["id"]]
        assert len(found) == 1
        assert found[0]["delivery_method"] == "lancha"

    def test_create_order_delivery_balcao_default(self, api_client, sample_product):
        # Without specifying delivery_method → should default to balcao
        payload = {
            "cpf": CLIENT_CPF,
            "items": [{
                "product_id": sample_product["id"],
                "name": sample_product["name"],
                "price": sample_product["price"],
                "qty": 1,
            }],
            "observation": "TEST_delivery_default",
        }
        r = api_client.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["delivery_method"] == "balcao"

    def test_create_order_delivery_balcao_explicit(self, api_client, sample_product):
        payload = {
            "cpf": CLIENT_CPF,
            "items": [{
                "product_id": sample_product["id"],
                "name": sample_product["name"],
                "price": sample_product["price"],
                "qty": 2,
            }],
            "delivery_method": "balcao",
        }
        r = api_client.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 200
        assert r.json()["delivery_method"] == "balcao"

    def test_create_order_invalid_delivery_falls_back(self, api_client, sample_product):
        payload = {
            "cpf": CLIENT_CPF,
            "items": [{
                "product_id": sample_product["id"],
                "name": sample_product["name"],
                "price": sample_product["price"],
                "qty": 1,
            }],
            "delivery_method": "drone",  # invalid
        }
        r = api_client.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 200
        # backend normalizes to "balcao" if not in allowed set
        assert r.json()["delivery_method"] == "balcao"

    def test_list_orders_admin_shows_delivery(self, api_client):
        # Admin list (no cpf) returns all
        r = api_client.get(f"{API}/convenience/orders")
        assert r.status_code == 200
        orders = r.json()
        assert len(orders) > 0
        # New orders should carry a delivery_method; legacy ones may lack it (frontend defaults to balcao).
        new_orders = [o for o in orders if "delivery_method" in o]
        assert len(new_orders) > 0
        for o in new_orders[:20]:
            assert o["delivery_method"] in ("balcao", "lancha")


class TestLogin:
    def test_admin_login(self, api_client):
        r = api_client.post(f"{API}/login", json={"cpf": "00000", "phone": "0000"})
        assert r.status_code == 200
        u = r.json()
        assert u["is_admin"] is True

    def test_client_login(self, api_client):
        r = api_client.post(f"{API}/login", json={"cpf": "11111", "phone": "1111"})
        assert r.status_code == 200
        u = r.json()
        assert u["cpf"] == CLIENT_CPF
