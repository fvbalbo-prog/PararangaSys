"""Marina Pararanga backend API tests."""
import os
from datetime import datetime
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://lancha-scheduler.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

TODAY = datetime.now().strftime("%Y-%m-%d")


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- Login ----
class TestLogin:
    def test_login_valid_cpf(self, client):
        r = client.post(f"{API}/login", json={"cpf": "11111111111"})
        assert r.status_code == 200
        d = r.json()
        assert d["cpf"] == "11111111111"
        assert d["name"] == "João Silva"
        assert d["boat_name"] == "Netuno"

    def test_login_formatted_cpf(self, client):
        r = client.post(f"{API}/login", json={"cpf": "111.111.111-11"})
        assert r.status_code == 200
        assert r.json()["cpf"] == "11111111111"

    def test_login_unregistered_cpf_returns_404(self, client):
        r = client.post(f"{API}/login", json={"cpf": "99999999999"})
        assert r.status_code == 404

    def test_login_invalid_cpf_returns_400(self, client):
        r = client.post(f"{API}/login", json={"cpf": "123"})
        assert r.status_code == 400


# ---- Requests: descida ----
class TestDescidaRequests:
    created_ids = []

    def test_create_descida_valid(self, client):
        payload = {
            "type": "descida", "cpf": "11111111111",
            "date": TODAY, "time": "10:00",
            "expected_return_date": TODAY, "expected_return_time": "16:00",
            "destination": "TEST_Ilha", "passengers": 4,
            "responsible": "TEST_João", "observation": "TEST_obs"
        }
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "descida"
        assert d["destination"] == "TEST_Ilha"
        assert d["user_name"] == "João Silva"
        assert d["boat_name"] == "Netuno"
        assert "id" in d
        TestDescidaRequests.created_ids.append(d["id"])

        # verify persistence
        g = client.get(f"{API}/requests/{d['id']}")
        assert g.status_code == 200
        assert g.json()["destination"] == "TEST_Ilha"

    def test_descida_time_out_of_range_returns_400(self, client):
        payload = {
            "type": "descida", "cpf": "11111111111",
            "date": TODAY, "time": "18:00",
            "expected_return_date": TODAY, "expected_return_time": "20:00",
            "destination": "X", "passengers": 1, "responsible": "R"
        }
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 400
        assert "08:30" in r.json()["detail"]

    def test_descida_missing_required_returns_400(self, client):
        payload = {
            "type": "descida", "cpf": "11111111111",
            "date": TODAY, "time": "10:00"
        }
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 400
        assert "obrigat" in r.json()["detail"].lower()


# ---- Requests: subida ----
class TestSubidaRequests:
    created_ids = []

    def test_create_subida_valid(self, client):
        payload = {"type": "subida", "cpf": "22222222222", "date": TODAY, "time": "17:00"}
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "subida"
        assert d["user_name"] == "Maria Santos"
        TestSubidaRequests.created_ids.append(d["id"])

    def test_subida_time_out_of_range_returns_400(self, client):
        payload = {"type": "subida", "cpf": "22222222222", "date": TODAY, "time": "18:00"}
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 400
        assert "17:30" in r.json()["detail"]


# ---- Update / Today ----
class TestUpdateAndList:
    def test_update_descida(self, client):
        # create then update
        payload = {
            "type": "descida", "cpf": "33333333333",
            "date": TODAY, "time": "09:00",
            "expected_return_date": TODAY, "expected_return_time": "14:00",
            "destination": "TEST_Orig", "passengers": 2, "responsible": "R"
        }
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 200
        rid = r.json()["id"]

        up = client.put(f"{API}/requests/{rid}", json={"destination": "TEST_Updated", "passengers": 5})
        assert up.status_code == 200
        assert up.json()["destination"] == "TEST_Updated"
        assert up.json()["passengers"] == 5

        g = client.get(f"{API}/requests/{rid}")
        assert g.json()["destination"] == "TEST_Updated"

    def test_today_descida(self, client):
        r = client.get(f"{API}/requests/today?type=descida")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert all(x["type"] == "descida" and x["date"] == TODAY for x in data)

    def test_today_subida(self, client):
        r = client.get(f"{API}/requests/today?type=subida")
        assert r.status_code == 200
        assert all(x["type"] == "subida" for x in r.json())

    def test_get_request_not_found(self, client):
        r = client.get(f"{API}/requests/nonexistent-id-xyz")
        assert r.status_code == 404
