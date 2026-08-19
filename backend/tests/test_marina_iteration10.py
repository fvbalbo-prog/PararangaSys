"""Iteration 10 backend tests - Marina Pararanga
Features:
- Staff signup via POST /api/users (is_staff=true)
- Reboque quote & creation with billing table
- PATCH /api/emergencies/{id}/bill
- GET /api/reports/consumo?month=YYYY-MM
- Regression on core endpoints
"""
import os
import re
import uuid
import requests
import pytest
from datetime import datetime, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"


# ---------------------- fixtures ----------------------
@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def staff_user_cpf(api_client):
    """Create a staff user for testing. Prefer seed staff 55555 to avoid creation churn."""
    return "55555555555"


# ---------------------- login tests ----------------------
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
        assert u["cpf"] == "11111111111"
        assert u.get("is_admin") is not True

    def test_staff_login(self, api_client):
        r = api_client.post(f"{API}/login", json={"cpf": "55555", "phone": "0055"})
        assert r.status_code == 200
        u = r.json()
        assert u.get("is_staff") is True

    def test_funcionario_created_via_curl_login(self, api_client):
        """Funcionário 77777 (CPF 77777777777, phone ending 0077) should be staff."""
        r = api_client.post(f"{API}/login", json={"cpf": "77777", "phone": "0077"})
        # If the user pre-exists, must be staff. If not, we skip.
        if r.status_code == 404:
            pytest.skip("Funcionário 77777 não foi pré-criado")
        assert r.status_code == 200
        u = r.json()
        assert u.get("is_staff") is True, f"user should be staff: {u}"

    def test_bad_login(self, api_client):
        r = api_client.post(f"{API}/login", json={"cpf": "99999", "phone": "9999"})
        assert r.status_code == 404


# ---------------------- staff signup ----------------------
class TestStaffSignup:
    """POST /api/users with is_staff=true"""

    _created_cpf = None

    def test_create_staff_user(self, api_client):
        cpf = "88888888888"
        # cleanup first (delete via direct API not available - use unique cpf)
        payload = {
            "cpf": cpf,
            "name": "TEST_Funcionario Iter10",
            "phone": "(48) 90000-0088",
            "boats": [],
            "is_staff": True,
        }
        r = api_client.post(f"{API}/users", json=payload)
        if r.status_code == 409:
            # Already exists, try alternate
            cpf = "88000000088"
            payload["cpf"] = cpf
            r = api_client.post(f"{API}/users", json=payload)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["is_staff"] is True
        assert u["boats"] == []
        TestStaffSignup._created_cpf = cpf

    def test_list_users_includes_staff(self, api_client):
        r = api_client.get(f"{API}/users")
        assert r.status_code == 200
        users = r.json()
        # seed staff 55555 or created 888
        cpfs = {u["cpf"] for u in users}
        assert "55555555555" in cpfs
        staffs = [u for u in users if u.get("is_staff")]
        assert len(staffs) >= 1

    def test_list_users_excludes_admin(self, api_client):
        r = api_client.get(f"{API}/users")
        users = r.json()
        assert all(u.get("is_admin") is not True for u in users)


# ---------------------- reboque quote ----------------------
class TestReboqueQuote:
    """GET /api/reboque/quote?length=&distance="""

    @pytest.mark.parametrize("length,distance,expected", [
        (24, 8, 1560.0),   # <=25: 1200 + (8-5)*120 = 1560
        (25, 5, 1200.0),   # <=25 boundary, no additional
        (30, 10, 2700.0),  # 26-35: 1800 + (10-5)*180 = 2700
        (35, 5, 1800.0),   # boundary
        (40, 10, 3750.0),  # 36+: 2500 + (10-5)*250 = 3750
        (50, 5, 2500.0),
        (22, 3, 1200.0),   # distance < 5 -> no additional
    ])
    def test_quote_values(self, api_client, length, distance, expected):
        r = api_client.get(f"{API}/reboque/quote", params={"length": length, "distance": distance})
        assert r.status_code == 200
        data = r.json()
        assert data["estimated_total"] == expected, f"{length}ft/{distance}NM => {data}"
        assert data["included_nm"] == 5.0


# ---------------------- reboque create ----------------------
class TestReboqueCreate:
    _created_ids = []

    def test_create_reboque_uses_client_boat_length(self, api_client):
        # João Silva CPF 11111111111 has Netuno at 22 pés (<=25 => base 1200, per_nm 120)
        payload = {
            "cpf": "11111111111",
            "boat_name": "Netuno",
            "distance_nm": 8,
            "location": "TEST_iter10 near ilha",
            "observation": "TEST_iter10 reboque",
        }
        r = api_client.post(f"{API}/reboque", json=payload)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["kind"] == "reboque"
        assert doc["boat_name"] == "Netuno"
        assert doc["boat_length"] == 22
        assert doc["estimated_total"] == 1560.0  # 1200 + 3*120
        assert doc["status"] == "aberta"
        assert doc["billed_amount"] is None
        TestReboqueCreate._created_ids.append(doc["id"])

    def test_reboque_shows_in_emergencies_list(self, api_client):
        r = api_client.get(f"{API}/emergencies", params={"cpf": "11111111111"})
        assert r.status_code == 200
        rebs = [e for e in r.json() if e.get("kind") == "reboque"]
        assert any(e["id"] in TestReboqueCreate._created_ids for e in rebs)


# ---------------------- billing ----------------------
class TestBilling:
    def test_bill_a_reboque(self, api_client):
        assert TestReboqueCreate._created_ids, "need a reboque from previous test"
        rid = TestReboqueCreate._created_ids[0]
        r = api_client.patch(f"{API}/emergencies/{rid}/bill", json={"amount": 1600.5})
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["billed_amount"] == 1600.5
        assert doc["billed_at"] is not None
        # verify persistence
        r2 = api_client.get(f"{API}/emergencies", params={"cpf": doc["cpf"]})
        found = next((e for e in r2.json() if e["id"] == rid), None)
        assert found and found["billed_amount"] == 1600.5

    def test_bill_unknown_emergency_returns_404(self, api_client):
        r = api_client.patch(f"{API}/emergencies/no-such-id/bill", json={"amount": 10})
        assert r.status_code == 404


# ---------------------- relatório de consumo ----------------------
class TestConsumoReport:
    _order_id = None
    _reboque_id = None

    def test_seed_data_for_report(self, api_client):
        # Create a small non-cancelled convenience order for João this month
        payload = {
            "cpf": "11111111111",
            "boat_name": "Netuno",
            "items": [{"product_id": "seed-agua", "name": "Água mineral", "price": 24.0, "qty": 1}],
            "observation": "TEST_iter10 order",
        }
        r = api_client.post(f"{API}/convenience/orders", json=payload)
        assert r.status_code == 200
        TestConsumoReport._order_id = r.json()["id"]

    def test_current_month_report(self, api_client):
        now = datetime.now(timezone.utc)
        month = f"{now.year}-{now.month:02d}"
        r = api_client.get(f"{API}/reports/consumo", params={"month": month})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["month"] == month
        assert "grand_total" in data
        assert isinstance(data["clients"], list)
        # João should have both convenience & reboque totals
        joao = next((c for c in data["clients"] if c["cpf"] == "11111111111"), None)
        assert joao is not None, f"João not in report: {data}"
        assert joao["convenience_total"] >= 24.0
        assert joao["reboque_total"] >= 1600.5  # from TestBilling
        assert joao["total"] == round(joao["convenience_total"] + joao["reboque_total"], 2)
        assert data["grand_total"] >= joao["total"]

    def test_report_defaults_to_current_month(self, api_client):
        r = api_client.get(f"{API}/reports/consumo")
        assert r.status_code == 200
        now = datetime.now(timezone.utc)
        assert r.json()["month"] == f"{now.year}-{now.month:02d}"

    def test_past_month_empty(self, api_client):
        r = api_client.get(f"{API}/reports/consumo", params={"month": "2020-01"})
        assert r.status_code == 200
        data = r.json()
        assert data["grand_total"] == 0
        assert data["clients"] == []

    def test_cleanup_convenience_order(self, api_client):
        if TestConsumoReport._order_id:
            api_client.patch(
                f"{API}/convenience/orders/{TestConsumoReport._order_id}/status",
                params={"status": "cancelada"},
            )


# ---------------------- regression ----------------------
class TestRegression:
    def test_products_list(self, api_client):
        r = api_client.get(f"{API}/products")
        assert r.status_code == 200
        prods = r.json()
        assert len(prods) >= 4
        cats = {p.get("category") for p in prods}
        # Should cover the 4 categories
        assert {"Bebidas", "Sorvetes", "Açaí", "Outros"}.issubset(cats)

    def test_convenience_orders_list(self, api_client):
        r = api_client.get(f"{API}/convenience/orders")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_emergencies_list(self, api_client):
        r = api_client.get(f"{API}/emergencies")
        assert r.status_code == 200

    def test_authorizations_flow(self, api_client):
        payload = {
            "cpf": "11111111111",
            "boat_name": "Netuno",
            "person_name": "TEST_iter10 Fulano",
            "date": datetime.now().strftime("%Y-%m-%d"),
        }
        r = api_client.post(f"{API}/authorizations", json=payload)
        assert r.status_code == 200
        aid = r.json()["id"]
        # checkin
        r2 = api_client.patch(f"{API}/authorizations/{aid}/checkin")
        assert r2.status_code == 200
        assert r2.json()["entered_at"] is not None
        # cancel (cleanup)
        r3 = api_client.patch(f"{API}/authorizations/{aid}/cancel")
        assert r3.status_code == 200
        assert r3.json()["status"] == "cancelada"

    def test_requests_lifecycle(self, api_client):
        # Create a subida (simpler validation)
        payload = {
            "type": "subida",
            "cpf": "11111111111",
            "date": datetime.now().strftime("%Y-%m-%d"),
            "time": "17:30",  # unlimited slot
            "boat_name": "Netuno",
        }
        r = api_client.post(f"{API}/requests", json=payload)
        assert r.status_code in (200, 409), r.text
        if r.status_code == 200:
            rid = r.json()["id"]
            # cleanup
            api_client.delete(f"{API}/requests/{rid}")
