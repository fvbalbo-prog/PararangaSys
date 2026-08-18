"""
Marina Pararanga - Iteration 9.2 backend tests
Covers:
- Products with category (Bebidas/Sorvetes/Açaí/Outros; invalid -> Outros)
- Product image upload (POST /api/products/{id}/image + GET /api/files/{path})
- Authorization check-in (PATCH /api/authorizations/{id}/checkin sets entered_at)
- Regression: login, requests, convenience orders (in_stock=false -> 400),
  emergencies (create/list/resolve)
"""
import io
import os
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ==================== Products / Categories ====================
class TestProductsCategory:
    created_ids = []

    def test_create_product_with_valid_category(self, http):
        for cat in ["Bebidas", "Sorvetes", "Açaí", "Outros"]:
            r = http.post(f"{API}/products", json={"name": f"TEST_iter92_{cat}", "price": 9.9, "category": cat})
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["category"] == cat
            assert data["price"] == 9.9
            assert data["active"] is True
            assert data["in_stock"] is True
            assert data.get("image_url") is None
            TestProductsCategory.created_ids.append(data["id"])

    def test_create_product_invalid_category_defaults_to_outros(self, http):
        r = http.post(f"{API}/products", json={"name": "TEST_iter92_invalidcat", "price": 5.0, "category": "Pizza"})
        assert r.status_code == 200
        data = r.json()
        assert data["category"] == "Outros"
        TestProductsCategory.created_ids.append(data["id"])

    def test_update_product_category(self, http):
        pid = TestProductsCategory.created_ids[0]
        r = http.put(f"{API}/products/{pid}", json={"category": "Sorvetes"})
        assert r.status_code == 200
        assert r.json()["category"] == "Sorvetes"
        # invalid update -> Outros
        r = http.put(f"{API}/products/{pid}", json={"category": "Invalido"})
        assert r.status_code == 200
        assert r.json()["category"] == "Outros"

    def test_list_products_returns_category_and_image_url(self, http):
        r = http.get(f"{API}/products?all=true")
        assert r.status_code == 200
        items = r.json()
        # Every product should have category & image_url keys
        missing_cat = [p["id"] for p in items if "category" not in p]
        missing_img = [p["id"] for p in items if "image_url" not in p]
        assert not missing_cat, f"products missing category: {missing_cat}"
        assert not missing_img, f"products missing image_url: {missing_img}"

    def test_cleanup_products(self, http):
        for pid in TestProductsCategory.created_ids:
            http.delete(f"{API}/products/{pid}")


# ==================== Image upload ====================
# minimal valid 1x1 PNG
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf"
    b"\xc0\x00\x00\x00\x03\x00\x01^\xf3*:\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestProductImageUpload:
    pid = None
    image_url = None

    def test_upload_and_serve(self, http):
        r = http.post(f"{API}/products", json={"name": "TEST_iter92_img", "price": 3.0, "category": "Outros"})
        assert r.status_code == 200
        TestProductImageUpload.pid = r.json()["id"]

        files = {"file": ("t.png", io.BytesIO(_PNG), "image/png")}
        # requests: don't set json content-type here
        r = requests.post(f"{API}/products/{TestProductImageUpload.pid}/image", files=files, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["image_url"], "image_url missing"
        assert data["image_url"].startswith("/api/files/"), data["image_url"]
        TestProductImageUpload.image_url = data["image_url"]

        # Serve the file back
        r2 = requests.get(f"{BASE}{TestProductImageUpload.image_url}", timeout=60)
        assert r2.status_code == 200
        assert r2.headers.get("Content-Type", "").startswith("image/")
        assert len(r2.content) > 0

    def test_cleanup(self, http):
        if TestProductImageUpload.pid:
            http.delete(f"{API}/products/{TestProductImageUpload.pid}")


# ==================== Authorization check-in ====================
from datetime import datetime


class TestAuthorizationCheckin:
    aid = None

    def test_create_authorization_today_has_entered_at_null(self, http):
        today = datetime.now().strftime("%Y-%m-%d")
        r = http.post(f"{API}/authorizations", json={
            "cpf": "11111111111",
            "boat_name": "Netuno",
            "person_name": "TEST_iter92 Visitante",
            "date": today,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "ativa"
        assert data.get("entered_at") is None
        assert "entered_at" in data
        TestAuthorizationCheckin.aid = data["id"]

    def test_checkin_sets_entered_at(self, http):
        r = http.patch(f"{API}/authorizations/{TestAuthorizationCheckin.aid}/checkin")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("entered_at"), "entered_at not set after check-in"

    def test_list_includes_entered_at(self, http):
        r = http.get(f"{API}/authorizations?cpf=11111111111")
        assert r.status_code == 200
        docs = r.json()
        target = next((d for d in docs if d["id"] == TestAuthorizationCheckin.aid), None)
        assert target is not None
        assert target.get("entered_at")

    def test_checkin_not_found(self, http):
        r = http.patch(f"{API}/authorizations/does-not-exist/checkin")
        assert r.status_code == 404

    def test_cleanup(self, http):
        if TestAuthorizationCheckin.aid:
            http.patch(f"{API}/authorizations/{TestAuthorizationCheckin.aid}/cancel")


# ==================== Regression ====================
class TestRegression:
    def test_login_client(self, http):
        r = http.post(f"{API}/login", json={"cpf": "11111", "phone": "1111"})
        assert r.status_code == 200
        u = r.json()
        assert u["cpf"] == "11111111111"
        assert u["name"] == "João Silva"

    def test_login_admin(self, http):
        r = http.post(f"{API}/login", json={"cpf": "00000", "phone": "0000"})
        assert r.status_code == 200
        assert r.json().get("is_admin") is True

    def test_login_staff(self, http):
        r = http.post(f"{API}/login", json={"cpf": "55555", "phone": "0055"})
        assert r.status_code == 200
        assert r.json().get("is_staff") is True

    def test_requests_create_and_delete(self, http):
        today = datetime.now().strftime("%Y-%m-%d")
        r = http.post(f"{API}/requests", json={
            "type": "subida", "cpf": "11111111111",
            "date": today, "time": "10:00", "boat_name": "Netuno",
        })
        # 200 or 409 (slot full) both acceptable for regression
        assert r.status_code in (200, 409), r.text
        if r.status_code == 200:
            rid = r.json()["id"]
            g = http.get(f"{API}/requests/{rid}")
            assert g.status_code == 200
            d = http.delete(f"{API}/requests/{rid}")
            assert d.status_code == 200

    def test_convenience_order_full_cycle(self, http):
        # Get an in-stock product
        prods = http.get(f"{API}/products").json()
        active = next((p for p in prods if p.get("active", True) and p.get("in_stock", True)), None)
        assert active, "no available product"
        r = http.post(f"{API}/convenience/orders", json={
            "cpf": "11111111111",
            "items": [{"product_id": active["id"], "name": active["name"], "price": active["price"], "qty": 1}],
        })
        assert r.status_code == 200, r.text
        oid = r.json()["id"]
        assert r.json()["status"] == "pendente"
        # list
        assert any(o["id"] == oid for o in http.get(f"{API}/convenience/orders?cpf=11111111111").json())
        # set status
        r2 = http.patch(f"{API}/convenience/orders/{oid}/status?status=entregue")
        assert r2.status_code == 200
        assert r2.json()["status"] == "entregue"

    def test_convenience_out_of_stock_returns_400(self, http):
        # create a product, toggle out of stock, order it -> 400
        p = http.post(f"{API}/products", json={"name": "TEST_iter92_nostk", "price": 2.0, "category": "Outros"}).json()
        http.put(f"{API}/products/{p['id']}", json={"in_stock": False})
        r = http.post(f"{API}/convenience/orders", json={
            "cpf": "11111111111",
            "items": [{"product_id": p["id"], "name": p["name"], "price": p["price"], "qty": 1}],
        })
        assert r.status_code == 400
        assert "estoque" in r.json()["detail"].lower()
        http.delete(f"{API}/products/{p['id']}")

    def test_emergency_lifecycle(self, http):
        r = http.post(f"{API}/emergencies", json={
            "cpf": "11111111111", "location": "TEST_iter92 spot", "observation": "TEST_iter92"
        })
        assert r.status_code == 200
        eid = r.json()["id"]
        assert r.json()["status"] == "aberta"
        assert any(e["id"] == eid for e in http.get(f"{API}/emergencies").json())
        r2 = http.patch(f"{API}/emergencies/{eid}/resolve")
        assert r2.status_code == 200
        assert r2.json()["status"] == "atendida"
