"""Iteration 5 tests: TábuaMaré tide integration, half-hour slot validation,
capacity enforcement (3/slot; subida 17:30 unlimited), and /api/slots availability."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://lancha-scheduler.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CPF_JOAO = "11111111111"
CPF_MARIA = "22222222222"
CPF_CARLOS = "33333333333"

TEST_DATE = "2026-08-18"  # far-future date to avoid clashing with today's data


@pytest.fixture(scope="module")
def s():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    yield session
    # cleanup: delete any test requests created on TEST_DATE
    try:
        rr = session.get(f"{API}/requests/day?date={TEST_DATE}")
        if rr.ok:
            for r in rr.json():
                session.delete(f"{API}/requests/{r['id']}")
    except Exception:
        pass


def _descida_payload(cpf, date, t, boat="Netuno"):
    return {
        "type": "descida", "cpf": cpf, "date": date, "time": t,
        "boat_name": boat,
        "expected_return_date": date, "expected_return_time": "16:00",
        "destination": "TEST_Ilha", "passengers": 2, "responsible": "TEST_Resp",
    }


def _subida_payload(cpf, date, t, boat="Netuno"):
    return {"type": "subida", "cpf": cpf, "date": date, "time": t, "boat_name": boat}


# ---------- Tide API (TábuaMaré) ----------
class TestTides:
    def test_get_tides_returns_points(self, s):
        r = s.get(f"{API}/tides/{TEST_DATE}")
        assert r.status_code == 200
        data = r.json()
        assert data["date"] == TEST_DATE
        assert data["harbor"] == "sp01"
        assert isinstance(data["points"], list)
        assert len(data["points"]) >= 2, f"expected tide extremes, got {data['points']}"
        for p in data["points"]:
            assert "time" in p and "height" in p
            assert isinstance(p["height"], (int, float))
            # HH:MM format
            assert len(p["time"]) == 5 and p["time"][2] == ":"

    def test_get_tides_cached_second_call(self, s):
        r1 = s.get(f"{API}/tides/{TEST_DATE}")
        r2 = s.get(f"{API}/tides/{TEST_DATE}")
        assert r1.json()["points"] == r2.json()["points"]


# ---------- Half-hour validation ----------
class TestHalfHour:
    def test_reject_non_half_hour(self, s):
        r = s.post(f"{API}/requests", json=_descida_payload(CPF_JOAO, TEST_DATE, "10:15"))
        assert r.status_code == 400
        assert "meia" in r.json()["detail"].lower()

    def test_reject_15(self, s):
        r = s.post(f"{API}/requests", json=_descida_payload(CPF_JOAO, TEST_DATE, "10:45"))
        assert r.status_code == 400

    def test_accept_hh_00(self, s):
        r = s.post(f"{API}/requests", json=_descida_payload(CPF_JOAO, TEST_DATE, "11:00"))
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        s.delete(f"{API}/requests/{rid}")

    def test_accept_hh_30(self, s):
        r = s.post(f"{API}/requests", json=_descida_payload(CPF_JOAO, TEST_DATE, "11:30"))
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        s.delete(f"{API}/requests/{rid}")


# ---------- Tide height persistence ----------
class TestTidePersistence:
    def test_create_stores_tide_height(self, s):
        payload = _descida_payload(CPF_MARIA, TEST_DATE, "12:00", boat="Poseidon")
        payload["tide_height"] = 0.63
        r = s.post(f"{API}/requests", json=payload)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        got = s.get(f"{API}/requests/{rid}").json()
        assert got["tide_height"] == 0.63
        s.delete(f"{API}/requests/{rid}")

    def test_update_stores_tide_height(self, s):
        payload = _descida_payload(CPF_MARIA, TEST_DATE, "12:30", boat="Poseidon")
        payload["tide_height"] = 0.30
        r = s.post(f"{API}/requests", json=payload)
        rid = r.json()["id"]
        upd = s.put(f"{API}/requests/{rid}", json={"tide_height": 0.85})
        assert upd.status_code == 200, upd.text
        got = s.get(f"{API}/requests/{rid}").json()
        assert got["tide_height"] == 0.85
        s.delete(f"{API}/requests/{rid}")


# ---------- Capacity ----------
class TestCapacity:
    def test_descida_capacity_409_with_suggestion(self, s):
        ids = []
        for cpf, boat in [(CPF_JOAO, "Netuno"), (CPF_MARIA, "Poseidon"), (CPF_CARLOS, "Aurora")]:
            r = s.post(f"{API}/requests", json=_descida_payload(cpf, TEST_DATE, "13:00", boat=boat))
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        # 4th must fail with 409 and next-slot suggestion
        r4 = s.post(f"{API}/requests", json=_descida_payload(CPF_MARIA, TEST_DATE, "13:00", boat="Sereia"))
        assert r4.status_code == 409, r4.text
        detail = r4.json()["detail"]
        assert "lotado" in detail.lower()
        assert "13:30" in detail  # next slot suggested
        for rid in ids:
            s.delete(f"{API}/requests/{rid}")

    def test_subida_1730_unlimited(self, s):
        ids = []
        for cpf, boat in [(CPF_JOAO, "Netuno"), (CPF_MARIA, "Poseidon"),
                          (CPF_CARLOS, "Aurora"), (CPF_MARIA, "Sereia")]:
            r = s.post(f"{API}/requests", json=_subida_payload(cpf, TEST_DATE, "17:30", boat=boat))
            assert r.status_code == 200, f"{cpf} {boat}: {r.text}"
            ids.append(r.json()["id"])
        assert len(ids) == 4  # >3 allowed
        for rid in ids:
            s.delete(f"{API}/requests/{rid}")

    def test_subida_non_1730_still_limited(self, s):
        ids = []
        for cpf, boat in [(CPF_JOAO, "Netuno"), (CPF_MARIA, "Poseidon"), (CPF_CARLOS, "Aurora")]:
            r = s.post(f"{API}/requests", json=_subida_payload(cpf, TEST_DATE, "15:00", boat=boat))
            assert r.status_code == 200
            ids.append(r.json()["id"])
        r4 = s.post(f"{API}/requests", json=_subida_payload(CPF_MARIA, TEST_DATE, "15:00", boat="Sereia"))
        assert r4.status_code == 409
        for rid in ids:
            s.delete(f"{API}/requests/{rid}")


# ---------- Slots endpoint ----------
class TestSlots:
    def test_slots_descida_shape(self, s):
        r = s.get(f"{API}/slots?type=descida&date={TEST_DATE}")
        assert r.status_code == 200
        arr = r.json()
        times = [x["time"] for x in arr]
        assert times[0] == "08:30"
        assert times[-1] == "17:00"
        # half-hour cadence
        assert "10:00" in times and "10:30" in times
        assert all(x["capacity"] == 3 and x["unlimited"] is False for x in arr)

    def test_slots_subida_1730_unlimited(self, s):
        r = s.get(f"{API}/slots?type=subida&date={TEST_DATE}")
        assert r.status_code == 200
        arr = r.json()
        by_time = {x["time"]: x for x in arr}
        assert "17:30" in by_time
        assert by_time["17:30"]["unlimited"] is True
        assert by_time["17:30"]["capacity"] is None
        assert by_time["17:30"]["available"] is True

    def test_slots_reflects_bookings(self, s):
        # book 3 at 14:00 descida
        ids = []
        for cpf, boat in [(CPF_JOAO, "Netuno"), (CPF_MARIA, "Poseidon"), (CPF_CARLOS, "Aurora")]:
            r = s.post(f"{API}/requests", json=_descida_payload(cpf, TEST_DATE, "14:00", boat=boat))
            ids.append(r.json()["id"])
        arr = s.get(f"{API}/slots?type=descida&date={TEST_DATE}").json()
        slot = next(x for x in arr if x["time"] == "14:00")
        assert slot["count"] == 3
        assert slot["available"] is False
        for rid in ids:
            s.delete(f"{API}/requests/{rid}")


# ---------- Regression: login/status ----------
class TestRegression:
    def test_login_admin(self, s):
        r = s.post(f"{API}/login", json={"cpf": "00000000000"})
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_login_client(self, s):
        r = s.post(f"{API}/login", json={"cpf": CPF_MARIA})
        assert r.status_code == 200
        assert r.json()["name"] == "Maria Santos"
        assert len(r.json()["boats"]) == 3
