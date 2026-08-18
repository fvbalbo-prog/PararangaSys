"""Iteration 6 - Admin Concluir button, delay alerts, Cadastrar Lanchas."""
import os
import uuid
from datetime import datetime, timedelta
import pytest
import requests

BASE_URL = (os.environ.get('EXPO_BACKEND_URL')
            or os.environ.get('EXPO_PUBLIC_BACKEND_URL')
            or 'https://lancha-scheduler.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

TEST_CPF = f"99{str(uuid.uuid4().int)[:9]}"[:11]  # 11-digit synthetic cpf


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    # cleanup: remove any test-created request docs (using today's future test slots)
    try:
        r = s.get(f"{API}/requests/day")
        for doc in r.json():
            if doc.get("responsible", "").startswith("TEST_"):
                s.delete(f"{API}/requests/{doc['id']}")
    except Exception:
        pass


# ============== Boats-as-objects list ==============
def test_list_users_returns_boat_objects(session):
    r = session.get(f"{API}/users")
    assert r.status_code == 200
    users = r.json()
    assert len(users) >= 3
    # verify seeded Maria has 3 boats-objects
    maria = next((u for u in users if u["cpf"] == "22222222222"), None)
    assert maria is not None
    assert len(maria["boats"]) == 3
    for b in maria["boats"]:
        assert isinstance(b, dict)
        assert "name" in b
        assert "draft" in b
        assert "length" in b
    # ensure admin is filtered out
    assert not any(u["cpf"] == "00000000000" for u in users)


# ============== Create client ==============
def test_create_client_invalid_cpf(session):
    r = session.post(f"{API}/users", json={"cpf": "123", "name": "TEST X", "phone": "x", "boats": []})
    assert r.status_code == 400


def test_create_client_and_duplicate(session):
    payload = {"cpf": TEST_CPF, "name": "TEST_ClienteZ", "phone": "(48) 91234-5678", "boats": []}
    r = session.post(f"{API}/users", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cpf"] == TEST_CPF
    assert body["name"] == "TEST_ClienteZ"
    assert body["boats"] == []
    # duplicate
    r2 = session.post(f"{API}/users", json=payload)
    assert r2.status_code == 409


# ============== Add/remove boats ==============
def test_add_boat_persistence(session):
    r = session.post(f"{API}/users/{TEST_CPF}/boats",
                     json={"name": "TEST_Lancha1", "draft": 1.2, "length": 28})
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(b["name"] == "TEST_Lancha1" and b["draft"] == 1.2 and b["length"] == 28 for b in body["boats"])
    # GET verify
    g = session.get(f"{API}/users/{TEST_CPF}")
    assert g.status_code == 200
    assert any(b["name"] == "TEST_Lancha1" for b in g.json()["boats"])


def test_add_boat_duplicate(session):
    r = session.post(f"{API}/users/{TEST_CPF}/boats",
                     json={"name": "TEST_Lancha1", "draft": 1.0, "length": 22})
    assert r.status_code == 409


def test_remove_boat(session):
    r = session.delete(f"{API}/users/{TEST_CPF}/boats", params={"boat": "TEST_Lancha1"})
    assert r.status_code == 200
    assert not any(b["name"] == "TEST_Lancha1" for b in r.json()["boats"])


def test_add_boat_missing_cpf(session):
    r = session.post(f"{API}/users/00000000009/boats",
                     json={"name": "X", "draft": 0.5, "length": 20})
    assert r.status_code == 404


# ============== PATCH complete ==============
def test_complete_request_sets_concluida(session):
    today = datetime.now().strftime("%Y-%m-%d")
    # find an open subida slot in the future today (or tomorrow)
    slots = session.get(f"{API}/slots", params={"type": "subida", "date": today}).json()
    open_slot = next((s for s in slots if s["available"] and not s["unlimited"]), None)
    if not open_slot:
        # use tomorrow
        today = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        slots = session.get(f"{API}/slots", params={"type": "subida", "date": today}).json()
        open_slot = next((s for s in slots if s["available"] and not s["unlimited"]), None)
    assert open_slot, "No open subida slot"

    create = session.post(f"{API}/requests", json={
        "type": "subida", "cpf": "11111111111",
        "date": today, "time": open_slot["time"],
        "boat_name": "Netuno",
    })
    assert create.status_code == 200, create.text
    rid = create.json()["id"]
    try:
        p = session.patch(f"{API}/requests/{rid}/complete")
        assert p.status_code == 200
        body = p.json()
        assert body["status"] == "concluida"
        assert body.get("returned_at")
        # GET verify persistence
        g = session.get(f"{API}/requests/{rid}").json()
        assert g["status"] == "concluida"
    finally:
        session.delete(f"{API}/requests/{rid}")


def test_complete_request_not_found(session):
    r = session.patch(f"{API}/requests/does-not-exist/complete")
    assert r.status_code == 404


# ============== Regression ==============
def test_login_client_and_admin(session):
    r = session.post(f"{API}/login", json={"cpf": "111.111.111-11"})
    assert r.status_code == 200
    assert r.json()["is_admin"] is False
    r2 = session.post(f"{API}/login", json={"cpf": "00000000000"})
    assert r2.status_code == 200
    assert r2.json()["is_admin"] is True


def test_tides_endpoint(session):
    r = session.get(f"{API}/tides/2026-08-18")
    assert r.status_code == 200
    data = r.json()
    assert "points" in data
    assert isinstance(data["points"], list)


def test_boat_name_saved_from_selection(session):
    today = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
    slots = session.get(f"{API}/slots", params={"type": "subida", "date": today}).json()
    open_slot = next((s for s in slots if s["available"] and not s["unlimited"]), None)
    assert open_slot
    r = session.post(f"{API}/requests", json={
        "type": "subida", "cpf": "22222222222",
        "date": today, "time": open_slot["time"],
        "boat_name": "Sereia",
    })
    assert r.status_code == 200
    rid = r.json()["id"]
    try:
        assert r.json()["boat_name"] == "Sereia"
    finally:
        session.delete(f"{API}/requests/{rid}")


def test_half_hour_and_capacity_still_works(session):
    today = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
    # bad minute
    r = session.post(f"{API}/requests", json={
        "type": "subida", "cpf": "11111111111", "date": today, "time": "10:15",
    })
    assert r.status_code == 400
    # capacity: create 3 subidas at same time then 4th fails
    ids = []
    try:
        for cpf in ["11111111111", "22222222222", "33333333333"]:
            r = session.post(f"{API}/requests", json={
                "type": "subida", "cpf": cpf, "date": today, "time": "09:00",
            })
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        r4 = session.post(f"{API}/requests", json={
            "type": "subida", "cpf": "11111111111", "date": today, "time": "09:00",
        })
        assert r4.status_code == 409
        assert "Próximo horário" in r4.json()["detail"]
    finally:
        for i in ids:
            session.delete(f"{API}/requests/{i}")


# ============== Cleanup created client ==============
def test_zz_cleanup_test_client(session):
    # No delete endpoint; just ensure list normalizes
    r = session.get(f"{API}/users")
    assert r.status_code == 200
    # try to remove our test client from mongo directly via API isn't available; leave it.
