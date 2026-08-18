"""Marina Pararanga - Iteration 4 tests: boats array on login, boat_name per request, observation on subida."""
import os
from datetime import datetime
import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"
TODAY = datetime.now().strftime("%Y-%m-%d")


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- Login returns boats array ----
class TestLoginBoats:
    def test_maria_three_boats(self, client):
        r = client.post(f"{API}/login", json={"cpf": "22222222222"})
        assert r.status_code == 200
        d = r.json()
        assert "boats" in d
        assert d["boats"] == ["Poseidon", "Sereia", "Vento Sul"]
        assert d["name"] == "Maria Santos"

    def test_carlos_two_boats(self, client):
        r = client.post(f"{API}/login", json={"cpf": "33333333333"})
        assert r.status_code == 200
        assert r.json()["boats"] == ["Aurora", "Estrela do Mar"]

    def test_joao_one_boat(self, client):
        r = client.post(f"{API}/login", json={"cpf": "11111111111"})
        assert r.status_code == 200
        assert r.json()["boats"] == ["Netuno"]

    def test_admin_no_regular_boats(self, client):
        r = client.post(f"{API}/login", json={"cpf": "00000000000"})
        assert r.status_code == 200
        d = r.json()
        assert d["is_admin"] is True
        assert d["boats"] == []


# ---- Descida with boat selection ----
class TestDescidaBoatSelection:
    def test_descida_with_selected_boat(self, client):
        payload = {
            "type": "descida", "cpf": "22222222222",
            "date": TODAY, "time": "09:30",
            "boat_name": "Sereia",
            "expected_return_date": TODAY, "expected_return_time": "16:00",
            "destination": "TEST_Ilha", "passengers": 4,
            "responsible": "TEST_Maria",
            "observation": "Levar coletes"
        }
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["boat_name"] == "Sereia"
        assert d["observation"] == "Levar coletes"
        # Verify persisted
        g = client.get(f"{API}/requests/{d['id']}").json()
        assert g["boat_name"] == "Sereia"
        assert g["observation"] == "Levar coletes"

    def test_descida_defaults_to_user_boat(self, client):
        payload = {
            "type": "descida", "cpf": "11111111111",
            "date": TODAY, "time": "10:00",
            "expected_return_date": TODAY, "expected_return_time": "15:00",
            "destination": "TEST_Def", "passengers": 2,
            "responsible": "TEST_Joao"
        }
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 200
        # No boat_name provided -> server fills with user.boat_name
        assert r.json()["boat_name"] == "Netuno"


# ---- Subida with boat selection + observation ----
class TestSubidaBoatObservation:
    def test_subida_with_boat_and_observation(self, client):
        payload = {
            "type": "subida", "cpf": "22222222222",
            "date": TODAY, "time": "15:00",
            "boat_name": "Vento Sul",
            "observation": "Atraso previsto"
        }
        r = client.post(f"{API}/requests", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["boat_name"] == "Vento Sul"
        assert d["observation"] == "Atraso previsto"
        # Verify persisted
        g = client.get(f"{API}/requests/{d['id']}").json()
        assert g["boat_name"] == "Vento Sul"
        assert g["observation"] == "Atraso previsto"

    def test_subida_update_boat_and_observation(self, client):
        # Create then update
        c = client.post(f"{API}/requests", json={
            "type": "subida", "cpf": "33333333333",
            "date": TODAY, "time": "14:30",
            "boat_name": "Aurora"
        })
        assert c.status_code == 200
        rid = c.json()["id"]
        u = client.put(f"{API}/requests/{rid}", json={
            "boat_name": "Estrela do Mar",
            "observation": "TEST_Nova obs"
        })
        assert u.status_code == 200
        assert u.json()["boat_name"] == "Estrela do Mar"
        assert u.json()["observation"] == "TEST_Nova obs"


# ---- Regression on today/history include boat_name ----
class TestBoatInLists:
    def test_history_contains_boat_name(self, client):
        # Ensure at least one exists
        client.post(f"{API}/requests", json={
            "type": "subida", "cpf": "22222222222",
            "date": TODAY, "time": "16:00",
            "boat_name": "Poseidon"
        })
        r = client.get(f"{API}/requests/history?cpf=22222222222")
        assert r.status_code == 200
        data = r.json()
        assert any(x.get("boat_name") == "Poseidon" for x in data)

    def test_day_contains_boat_name(self, client):
        r = client.get(f"{API}/requests/day?date={TODAY}")
        assert r.status_code == 200
        data = r.json()
        # every record should expose the boat_name field (may be None but key present)
        for x in data:
            assert "boat_name" in x
