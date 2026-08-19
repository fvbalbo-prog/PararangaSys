"""Backend tests for iteration 20 features:
- Convenience order status transitions: pendente -> em_preparo -> pronto -> entregue
- New status labels accepted by PATCH /api/convenience/orders/{id}/status
- GET /api/reports/weekly returns 7 days with {date, label, movements, revenue}
- Admin exit-quiosque pin: POST /api/login with admin cpf+pin validates
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://lancha-scheduler.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

CLIENT_CPF = "11111111111"
ADMIN_CPF5 = "00000"
ADMIN_PIN = "0000"


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
    for p in prods:
        if p.get("active", True) and p.get("in_stock", True):
            return p
    pytest.skip("No available product")


def _create_order(api_client, sample_product, delivery="lancha", obs="TEST_iter20"):
    payload = {
        "cpf": CLIENT_CPF,
        "boat_name": "Netuno",
        "items": [{
            "product_id": sample_product["id"],
            "name": sample_product["name"],
            "price": sample_product["price"],
            "qty": 1,
        }],
        "observation": obs,
        "delivery_method": delivery,
    }
    r = api_client.post(f"{API}/convenience/orders", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ============================== Health ==============================
class TestHealth:
    def test_root(self, api_client):
        r = api_client.get(f"{API}/")
        assert r.status_code == 200


# ============================== Convenience order status ==============================
class TestConvenienceOrderStatus:
    """Feature: novo fluxo pendente -> em_preparo -> pronto -> entregue."""

    def test_full_flow(self, api_client, sample_product):
        order = _create_order(api_client, sample_product, delivery="lancha", obs="TEST_iter20_flow")
        oid = order["id"]
        assert order["status"] == "pendente"

        # pendente -> em_preparo
        r = api_client.patch(f"{API}/convenience/orders/{oid}/status", params={"status": "em_preparo"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "em_preparo"

        # em_preparo -> pronto
        r = api_client.patch(f"{API}/convenience/orders/{oid}/status", params={"status": "pronto"})
        assert r.status_code == 200
        assert r.json()["status"] == "pronto"

        # pronto -> entregue
        r = api_client.patch(f"{API}/convenience/orders/{oid}/status", params={"status": "entregue"})
        assert r.status_code == 200
        assert r.json()["status"] == "entregue"

        # verify persistence via GET
        r2 = api_client.get(f"{API}/convenience/orders", params={"cpf": CLIENT_CPF})
        assert r2.status_code == 200
        found = [o for o in r2.json() if o["id"] == oid]
        assert len(found) == 1
        assert found[0]["status"] == "entregue"

    def test_cancel_status(self, api_client, sample_product):
        order = _create_order(api_client, sample_product, delivery="balcao", obs="TEST_iter20_cancel")
        r = api_client.patch(f"{API}/convenience/orders/{order['id']}/status", params={"status": "cancelada"})
        assert r.status_code == 200
        assert r.json()["status"] == "cancelada"

    def test_invalid_status_rejected(self, api_client, sample_product):
        order = _create_order(api_client, sample_product, delivery="balcao", obs="TEST_iter20_bad")
        r = api_client.patch(f"{API}/convenience/orders/{order['id']}/status", params={"status": "foo"})
        assert r.status_code == 400

    def test_status_not_found(self, api_client):
        r = api_client.patch(f"{API}/convenience/orders/nonexistent-id-xyz/status", params={"status": "pronto"})
        assert r.status_code == 404


# ============================== Weekly report ==============================
class TestWeeklyReport:
    def test_weekly_shape(self, api_client):
        r = api_client.get(f"{API}/reports/weekly")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 7
        allowed_labels = {"Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"}
        for item in data:
            assert set(["date", "label", "movements", "revenue"]).issubset(item.keys())
            assert item["label"] in allowed_labels
            assert isinstance(item["movements"], int)
            assert isinstance(item["revenue"], (int, float))
            # date shape YYYY-MM-DD
            assert len(item["date"]) == 10 and item["date"][4] == "-" and item["date"][7] == "-"


# ============================== Quiosque exit-pin (admin login) ==============================
class TestQuiosqueExitPin:
    def test_correct_pin_returns_admin(self, api_client):
        r = api_client.post(f"{API}/login", json={"cpf": ADMIN_CPF5, "phone": ADMIN_PIN})
        assert r.status_code == 200
        u = r.json()
        assert u.get("is_admin") is True

    def test_wrong_pin_rejected(self, api_client):
        r = api_client.post(f"{API}/login", json={"cpf": ADMIN_CPF5, "phone": "9999"})
        assert r.status_code >= 400 and r.status_code < 500


# ============================== Sanity: listing surfaces delivery_method + status labels ==============================
class TestOrdersListingHasFields:
    def test_admin_list_carries_status_and_delivery(self, api_client):
        r = api_client.get(f"{API}/convenience/orders")
        assert r.status_code == 200
        orders = r.json()
        assert len(orders) > 0
        # at least some newer orders should carry both fields
        with_fields = [o for o in orders if "status" in o and "delivery_method" in o]
        assert len(with_fields) > 0
        for o in with_fields[:30]:
            assert o["status"] in ("pendente", "em_preparo", "pronto", "entregue", "cancelada")
            assert o["delivery_method"] in ("balcao", "lancha")
