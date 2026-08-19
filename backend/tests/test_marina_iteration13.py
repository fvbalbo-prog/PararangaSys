"""Marina Pararanga - Iteration 15/13 tests.

Covers:
- POST /api/authorizations with validity_type = "data", "periodo", "recorrente"
- Validations: date required for data, start/end for periodo, end>=start
- GET /api/authorizations returns new fields
- PATCH /api/requests/{id}/complete creates client notification
- GET /api/notifications, PATCH /api/notifications/{id}/read, POST /api/notifications/read-all
"""
import os
from datetime import datetime, timezone, timedelta
import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

BR_TZ = timezone(timedelta(hours=-3))
TODAY = datetime.now(BR_TZ).strftime("%Y-%m-%d")
TOMORROW = (datetime.now(BR_TZ) + timedelta(days=1)).strftime("%Y-%m-%d")
PLUS7 = (datetime.now(BR_TZ) + timedelta(days=7)).strftime("%Y-%m-%d")

JOAO_CPF = "11111111111"


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _future_time_today():
    """Return an HH:MM at least 1h15 in the future, aligned to :00/:30, within 08:30-17:00."""
    now = datetime.now(BR_TZ) + timedelta(hours=1, minutes=15)
    # Round up to next :00 or :30
    if now.minute <= 30:
        now = now.replace(minute=30, second=0, microsecond=0)
    else:
        now = (now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
    h, m = now.hour, now.minute
    if (h, m) < (8, 30):
        h, m = 8, 30
    if (h, m) > (17, 0):
        return None  # Too late in the day
    return f"{h:02d}:{m:02d}"


# ================= Authorizations =================
class TestAuthorizationsValidity:
    """POST /api/authorizations with 3 validity types."""

    _created_ids = []

    def test_data_unica_requires_date(self, client):
        # Missing date -> 400
        r = client.post(f"{API}/authorizations", json={
            "cpf": JOAO_CPF, "boat_name": "Netuno",
            "person_name": "TEST_João Amigo", "validity_type": "data",
        })
        assert r.status_code == 400
        assert "data" in r.json()["detail"].lower()

    def test_data_unica_success(self, client):
        r = client.post(f"{API}/authorizations", json={
            "cpf": JOAO_CPF, "boat_name": "Netuno",
            "person_name": "TEST_Amigo Data", "validity_type": "data",
            "date": PLUS7, "can_lower": False,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["validity_type"] == "data"
        assert d["date"] == PLUS7
        assert d["start_date"] is None
        assert d["end_date"] is None
        assert d["status"] == "ativa"
        TestAuthorizationsValidity._created_ids.append(d["id"])

    def test_periodo_requires_both_dates(self, client):
        r = client.post(f"{API}/authorizations", json={
            "cpf": JOAO_CPF, "boat_name": "Netuno",
            "person_name": "TEST_Amigo Periodo", "validity_type": "periodo",
            "start_date": PLUS7,
        })
        assert r.status_code == 400

    def test_periodo_end_before_start(self, client):
        r = client.post(f"{API}/authorizations", json={
            "cpf": JOAO_CPF, "boat_name": "Netuno",
            "person_name": "TEST_Amigo Inv", "validity_type": "periodo",
            "start_date": PLUS7, "end_date": TODAY,
        })
        assert r.status_code == 400
        assert "posterior" in r.json()["detail"].lower() or "final" in r.json()["detail"].lower()

    def test_periodo_success(self, client):
        r = client.post(f"{API}/authorizations", json={
            "cpf": JOAO_CPF, "boat_name": "Netuno",
            "person_name": "TEST_Amigo Periodo OK", "validity_type": "periodo",
            "start_date": TODAY, "end_date": PLUS7, "can_lower": True,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["validity_type"] == "periodo"
        assert d["start_date"] == TODAY
        assert d["end_date"] == PLUS7
        assert d["date"] == TODAY  # backwards compat
        assert d["can_lower"] is True
        TestAuthorizationsValidity._created_ids.append(d["id"])

    def test_recorrente_no_dates(self, client):
        r = client.post(f"{API}/authorizations", json={
            "cpf": JOAO_CPF, "boat_name": "Netuno",
            "person_name": "TEST_Amigo Rec", "validity_type": "recorrente",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["validity_type"] == "recorrente"
        assert d["date"] is None
        assert d["start_date"] is None
        assert d["end_date"] is None
        TestAuthorizationsValidity._created_ids.append(d["id"])

    def test_list_returns_new_fields(self, client):
        r = client.get(f"{API}/authorizations?cpf={JOAO_CPF}")
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        assert len(docs) > 0
        # Verify newly-created records (from this test run) carry the new fields
        newly_created = [d for d in docs if d["id"] in TestAuthorizationsValidity._created_ids]
        assert len(newly_created) >= 3, "expected new auths in list"
        for d in newly_created:
            assert "validity_type" in d
            assert "start_date" in d
            assert "end_date" in d
            assert d["validity_type"] in ("data", "periodo", "recorrente")

    def test_cancel_authorization(self, client):
        if not TestAuthorizationsValidity._created_ids:
            pytest.skip("no auth created")
        aid = TestAuthorizationsValidity._created_ids[0]
        r = client.patch(f"{API}/authorizations/{aid}/cancel")
        assert r.status_code == 200
        assert r.json()["status"] == "cancelada"


# ================= Notifications on complete =================
class TestNotificationsOnComplete:
    """Descida request → complete → notification created for cpf."""

    def test_complete_descida_creates_notification(self, client):
        ft = _future_time_today()
        if not ft:
            pytest.skip("too late today for descida slot")
        # Create descida for today (with future time)
        payload = {
            "type": "descida", "cpf": JOAO_CPF,
            "date": TODAY, "time": ft,
            "expected_return_date": TODAY, "expected_return_time": "18:00" if ft < "17:00" else "23:00",
            "destination": "TEST_NotifDescida", "passengers": 2, "responsible": "TEST_Resp"
        }
        r = client.post(f"{API}/requests", json=payload)
        # Slot could be full; try subida fallback if capacity 409
        if r.status_code == 409:
            pytest.skip(f"slot full: {r.text}")
        assert r.status_code == 200, r.text
        req = r.json()
        rid = req["id"]

        # Count notifications before completing
        notifs_before = client.get(f"{API}/notifications?cpf={JOAO_CPF}").json()
        before_count = len(notifs_before)

        # Complete the request
        c = client.patch(f"{API}/requests/{rid}/complete")
        assert c.status_code == 200
        assert c.json()["status"] == "concluida"

        # Notification created
        notifs_after = client.get(f"{API}/notifications?cpf={JOAO_CPF}").json()
        assert len(notifs_after) == before_count + 1
        newest = notifs_after[0]  # sorted by created_at desc
        assert newest["kind"] == "descida"
        assert "água" in newest["title"].lower() or "agua" in newest["title"].lower()
        assert newest["read"] is False
        assert newest["cpf"] == JOAO_CPF

        # Mark read
        rid_n = newest["id"]
        rr = client.patch(f"{API}/notifications/{rid_n}/read")
        assert rr.status_code == 200
        after_read = client.get(f"{API}/notifications?cpf={JOAO_CPF}").json()
        this = next((x for x in after_read if x["id"] == rid_n), None)
        assert this is not None
        assert this["read"] is True

    def test_read_all_notifications(self, client):
        # Ensure there is at least one notification
        notifs = client.get(f"{API}/notifications?cpf={JOAO_CPF}").json()
        if not notifs:
            pytest.skip("no notifications to mark")
        r = client.post(f"{API}/notifications/read-all?cpf={JOAO_CPF}")
        assert r.status_code == 200
        after = client.get(f"{API}/notifications?cpf={JOAO_CPF}").json()
        assert all(n["read"] is True for n in after), "all notifications should be marked read"

    def test_complete_subida_creates_notification(self, client):
        ft = _future_time_today()
        if not ft:
            pytest.skip("too late today")
        # Subida allowed up to 17:30
        payload = {"type": "subida", "cpf": JOAO_CPF, "date": TODAY, "time": ft}
        r = client.post(f"{API}/requests", json=payload)
        if r.status_code == 409:
            pytest.skip(f"slot full: {r.text}")
        assert r.status_code == 200, r.text
        req = r.json()
        # Complete
        c = client.patch(f"{API}/requests/{req['id']}/complete")
        assert c.status_code == 200

        notifs = client.get(f"{API}/notifications?cpf={JOAO_CPF}").json()
        # Latest should be the subida
        latest = notifs[0]
        assert latest["kind"] == "subida"
        assert "seco" in latest["title"].lower() or "seco" in latest["body"].lower()


# ================= Booking window =================
class TestBookingWindow:
    def test_reject_past_date(self, client):
        past = (datetime.now(BR_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")
        r = client.post(f"{API}/requests", json={
            "type": "subida", "cpf": JOAO_CPF, "date": past, "time": "10:00"
        })
        assert r.status_code == 400

    def test_reject_day_after_tomorrow(self, client):
        future = (datetime.now(BR_TZ) + timedelta(days=3)).strftime("%Y-%m-%d")
        r = client.post(f"{API}/requests", json={
            "type": "subida", "cpf": JOAO_CPF, "date": future, "time": "10:00"
        })
        assert r.status_code == 400
        assert "hoje" in r.json()["detail"].lower() or "amanhã" in r.json()["detail"].lower()

    def test_tomorrow_allowed(self, client):
        r = client.post(f"{API}/requests", json={
            "type": "subida", "cpf": JOAO_CPF, "date": TOMORROW, "time": "17:30"
        })
        # 17:30 is unlimited slot for subida
        assert r.status_code == 200, r.text
        # cleanup
        client.delete(f"{API}/requests/{r.json()['id']}")
