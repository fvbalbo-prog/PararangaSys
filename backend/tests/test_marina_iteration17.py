"""
Iteration 17 - Emergency screen restructure tests

Backend features under test:
- POST /api/emergencies  (kind=socorro)
- POST /api/reboque      (kind=reboque, requires client_lat/client_lng or distance_nm)
- GET  /api/emergencies?cpf=  (lists user emergencies)
"""
import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
).rstrip("/")

TEST_CPF = "11111111111"
TEST_BOAT = "Netuno"


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- login ----------
class TestLogin:
    def test_login_joao(self, api):
        r = api.post(f"{BASE_URL}/api/login", json={"cpf": "11111", "phone": "1111"})
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["cpf"] == TEST_CPF
        assert u["name"].startswith("João")


# ---------- Emergencies (socorro) ----------
class TestEmergencySocorro:
    def test_create_socorro_success(self, api):
        payload = {
            "cpf": TEST_CPF,
            "boat_name": TEST_BOAT,
            "location": "TEST_iter17 - Próximo à Ilha do Campeche",
            "observation": "TEST_iter17 - Motor não liga",
        }
        r = api.post(f"{BASE_URL}/api/emergencies", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["kind"] == "socorro"
        assert data["cpf"] == TEST_CPF
        assert data["status"] == "aberta"
        assert data["location"] == payload["location"]
        assert data["observation"] == payload["observation"]
        assert "id" in data
        # ensures no mongodb _id leak
        assert "_id" not in data

    def test_create_socorro_invalid_cpf(self, api):
        # Use a CPF that definitely doesn't exist in seed or previous test data
        r = api.post(
            f"{BASE_URL}/api/emergencies",
            json={"cpf": "12345678909", "boat_name": "Fantasma"},
        )
        assert r.status_code == 404

    def test_list_emergencies_contains_created(self, api):
        # create one, then list
        payload = {
            "cpf": TEST_CPF,
            "boat_name": TEST_BOAT,
            "location": "TEST_iter17_list marker",
            "observation": "check persistence",
        }
        cr = api.post(f"{BASE_URL}/api/emergencies", json=payload)
        assert cr.status_code == 200
        created_id = cr.json()["id"]

        lr = api.get(f"{BASE_URL}/api/emergencies?cpf={TEST_CPF}")
        assert lr.status_code == 200
        items = lr.json()
        assert isinstance(items, list)
        ids = [e["id"] for e in items]
        assert created_id in ids
        # basic shape
        e = next(e for e in items if e["id"] == created_id)
        assert e["kind"] == "socorro"
        assert e["status"] == "aberta"


# ---------- Reboque ----------
class TestReboque:
    def test_reboque_quote_by_coords(self, api):
        # Coords ~2 nm from marina to keep additional_nm=0 (< 5 MN included)
        r = api.get(
            f"{BASE_URL}/api/reboque/quote",
            params={"length": 22, "client_lat": -23.8, "client_lng": -45.4},
        )
        assert r.status_code == 200, r.text
        q = r.json()
        for k in [
            "distance_nm",
            "included_nm",
            "additional_nm",
            "base_fee",
            "per_nm",
            "additional_fee",
            "estimated_total",
        ]:
            assert k in q, f"missing {k}"
        assert q["included_nm"] == 5.0
        # 22 pés -> primeira faixa (<=25): base 1200, per_nm 120
        assert q["base_fee"] == 1200.0
        assert q["per_nm"] == 120.0
        assert q["estimated_total"] >= q["base_fee"]

    def test_reboque_quote_requires_coords_or_distance(self, api):
        r = api.get(f"{BASE_URL}/api/reboque/quote", params={"length": 22})
        assert r.status_code == 400

    def test_create_reboque_with_coords(self, api):
        payload = {
            "cpf": TEST_CPF,
            "boat_name": TEST_BOAT,
            "client_lat": -23.9,
            "client_lng": -45.5,
            "location": "TEST_iter17 - offshore",
            "observation": "TEST_iter17 - precisa reboque",
        }
        r = api.post(f"{BASE_URL}/api/reboque", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["kind"] == "reboque"
        assert data["status"] == "aberta"
        assert data["cpf"] == TEST_CPF
        assert data["client_lat"] == payload["client_lat"]
        assert data["client_lng"] == payload["client_lng"]
        # reboque quote fields inlined
        assert "distance_nm" in data
        assert "estimated_total" in data
        assert data["estimated_total"] >= 1200.0

        # verify persisted via list
        lr = api.get(f"{BASE_URL}/api/emergencies?cpf={TEST_CPF}")
        assert lr.status_code == 200
        ids = [e["id"] for e in lr.json()]
        assert data["id"] in ids

    def test_create_reboque_missing_coords_and_distance(self, api):
        # neither coords nor distance_nm => 400
        r = api.post(
            f"{BASE_URL}/api/reboque",
            json={"cpf": TEST_CPF, "boat_name": TEST_BOAT},
        )
        assert r.status_code == 400
