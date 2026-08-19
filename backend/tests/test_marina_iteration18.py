"""
Iteration 18 - HUB Cadastros (Clientes / Lanchas / Funcionários)
Backend tests for the endpoints used by the new admin sub-screens:
  - GET  /api/users              (listUsers)
  - POST /api/users              (createClient with is_staff)
  - POST /api/users/{cpf}/boats  (addBoat)
  - DELETE /api/users/{cpf}/boats?boat=... (removeBoat)
  - PATCH /api/users/{cpf}/active (activate/deactivate)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://lancha-scheduler.preview.emergentagent.com").rstrip("/")

TEST_CLIENT_CPF = "91111000018"   # unique for this iteration
TEST_STAFF_CPF = "91111000018"     # will be reused, cleanup ensures uniqueness
TEST_CLIENT_CPF_A = "98111000018"
TEST_STAFF_CPF_B = "98222000018"
TEST_BOAT_NAME = "TEST_iter18_boat"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    # cleanup: best effort — remove test users from Mongo via API? there is no delete-user endpoint.
    # Deactivate to avoid polluting seeded flows. Boats are removed inside tests.
    for cpf in (TEST_CLIENT_CPF_A, TEST_STAFF_CPF_B):
        try:
            s.patch(f"{BASE_URL}/api/users/{cpf}/active", json={"active": False}, timeout=15)
        except Exception:
            pass


# --------------- listUsers ---------------
class TestListUsers:
    def test_list_users_returns_non_admin_only(self, api):
        r = api.get(f"{BASE_URL}/api/users", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        cpfs = [u["cpf"] for u in data]
        # Admin (00000000000) is filtered out by is_admin != True
        assert "00000000000" not in cpfs
        # Known seeded client + staff appear
        assert "11111111111" in cpfs
        assert "55555555555" in cpfs
        # Each user has is_staff key (used by frontend filtering)
        for u in data:
            assert "is_staff" in u
            assert "boats" in u and isinstance(u["boats"], list)

    def test_list_users_staff_flag(self, api):
        r = api.get(f"{BASE_URL}/api/users", timeout=20)
        assert r.status_code == 200
        users = {u["cpf"]: u for u in r.json()}
        assert users["55555555555"]["is_staff"] is True
        assert users["11111111111"]["is_staff"] is False


# --------------- createClient with is_staff ---------------
class TestCreateClient:
    def test_create_client_persists_and_is_staff_false(self, api):
        # ensure clean
        payload = {"cpf": TEST_CLIENT_CPF_A, "name": "TEST Iter18 Cliente",
                   "phone": "(48) 90000-0018", "boats": [], "is_staff": False}
        r = api.post(f"{BASE_URL}/api/users", json=payload, timeout=20)
        if r.status_code == 409:
            # already exists (previous run) – reactivate + continue
            api.patch(f"{BASE_URL}/api/users/{TEST_CLIENT_CPF_A}/active",
                      json={"active": True}, timeout=15)
        else:
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["cpf"] == TEST_CLIENT_CPF_A
            assert body["is_staff"] is False
            assert body["active"] is True

        # GET should list it under non-staff
        r2 = api.get(f"{BASE_URL}/api/users", timeout=20)
        assert r2.status_code == 200
        u = next((x for x in r2.json() if x["cpf"] == TEST_CLIENT_CPF_A), None)
        assert u is not None
        assert u["is_staff"] is False

    def test_create_staff_with_is_staff_true(self, api):
        payload = {"cpf": TEST_STAFF_CPF_B, "name": "TEST Iter18 Funcionario",
                   "phone": "(48) 90000-0055", "boats": [], "is_staff": True}
        r = api.post(f"{BASE_URL}/api/users", json=payload, timeout=20)
        if r.status_code == 409:
            api.patch(f"{BASE_URL}/api/users/{TEST_STAFF_CPF_B}/active",
                      json={"active": True}, timeout=15)
        else:
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["is_staff"] is True
            assert body["cpf"] == TEST_STAFF_CPF_B

        r2 = api.get(f"{BASE_URL}/api/users", timeout=20)
        u = next((x for x in r2.json() if x["cpf"] == TEST_STAFF_CPF_B), None)
        assert u is not None
        assert u["is_staff"] is True

    def test_create_duplicate_cpf_returns_409(self, api):
        payload = {"cpf": "11111111111", "name": "dup", "phone": "x", "boats": [], "is_staff": False}
        r = api.post(f"{BASE_URL}/api/users", json=payload, timeout=20)
        assert r.status_code == 409

    def test_create_invalid_cpf_returns_400(self, api):
        payload = {"cpf": "123", "name": "x", "phone": "y", "boats": [], "is_staff": False}
        r = api.post(f"{BASE_URL}/api/users", json=payload, timeout=20)
        assert r.status_code == 400


# --------------- boats add / remove ---------------
class TestBoats:
    def test_add_and_remove_boat(self, api):
        # Add
        r = api.post(
            f"{BASE_URL}/api/users/{TEST_CLIENT_CPF_A}/boats",
            json={"name": TEST_BOAT_NAME, "draft": 0.9, "length": 25},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert any(b["name"] == TEST_BOAT_NAME for b in body["boats"])

        # Duplicate add -> 409
        r_dup = api.post(
            f"{BASE_URL}/api/users/{TEST_CLIENT_CPF_A}/boats",
            json={"name": TEST_BOAT_NAME}, timeout=20,
        )
        assert r_dup.status_code == 409

        # Verify via GET /users/{cpf}
        r_get = api.get(f"{BASE_URL}/api/users/{TEST_CLIENT_CPF_A}", timeout=20)
        assert r_get.status_code == 200
        assert any(b["name"] == TEST_BOAT_NAME for b in r_get.json()["boats"])

        # Remove
        r_del = api.delete(
            f"{BASE_URL}/api/users/{TEST_CLIENT_CPF_A}/boats",
            params={"boat": TEST_BOAT_NAME}, timeout=20,
        )
        assert r_del.status_code == 200
        assert not any(b["name"] == TEST_BOAT_NAME for b in r_del.json()["boats"])

    def test_add_boat_unknown_cpf_returns_404(self, api):
        r = api.post(f"{BASE_URL}/api/users/00000000009/boats",
                     json={"name": "ghost"}, timeout=20)
        assert r.status_code == 404


# --------------- toggle active ---------------
class TestActive:
    def test_deactivate_and_reactivate(self, api):
        r_off = api.patch(f"{BASE_URL}/api/users/{TEST_CLIENT_CPF_A}/active",
                          json={"active": False}, timeout=20)
        assert r_off.status_code == 200
        assert r_off.json()["active"] is False

        # Login with deactivated user must return 403
        r_login = api.post(
            f"{BASE_URL}/api/login",
            json={"cpf": TEST_CLIENT_CPF_A[:5], "phone": "0018"},
            timeout=15,
        )
        assert r_login.status_code == 403

        r_on = api.patch(f"{BASE_URL}/api/users/{TEST_CLIENT_CPF_A}/active",
                         json={"active": True}, timeout=20)
        assert r_on.status_code == 200
        assert r_on.json()["active"] is True

    def test_active_unknown_cpf_returns_404(self, api):
        r = api.patch(f"{BASE_URL}/api/users/00000000009/active",
                      json={"active": True}, timeout=15)
        assert r.status_code == 404
