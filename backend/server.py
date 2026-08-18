from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, time


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# TábuaMaré API (São Sebastião - SP => harbor sp01). Works anonymously at a
# lower rate limit; the key raises the limit. Key stays only on the backend.
TABUAMARE_API_KEY = os.environ.get("TABUAMARE_API_KEY", "").strip()
TABUAMARE_BASE = "https://tabuamare.api.br/api/v2"
TABUAMARE_HARBOR = "sp01"

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ===================== Helpers =====================
def normalize_cpf(cpf: str) -> str:
    """Strip all non-digit characters from a CPF string."""
    return re.sub(r"\D", "", cpf or "")


def parse_hhmm(value: str) -> Optional[time]:
    try:
        h, m = value.split(":")
        return time(int(h), int(m))
    except Exception:
        return None


DESCIDA_MIN = time(8, 30)
DESCIDA_MAX = time(17, 0)
SUBIDA_MIN = time(8, 30)
SUBIDA_MAX = time(17, 30)


# ===================== Models =====================
class User(BaseModel):
    cpf: str
    name: str
    phone: str
    boat_name: str
    boats: List[str] = []
    is_admin: bool = False


class LoginInput(BaseModel):
    cpf: str


class RequestBase(BaseModel):
    # Type: "descida" | "subida"
    type: Literal["descida", "subida"]
    cpf: str
    # Date in ISO YYYY-MM-DD
    date: str
    # Time in HH:MM 24h
    time: str
    # Selected boat for this request
    boat_name: Optional[str] = None
    # Optional fields — only for descida
    expected_return_date: Optional[str] = None
    expected_return_time: Optional[str] = None
    destination: Optional[str] = None
    passengers: Optional[int] = None
    responsible: Optional[str] = None
    observation: Optional[str] = None
    # Predicted tide height (meters) at the requested time, from TábuaMaré
    tide_height: Optional[float] = None
    # Status: "agendada" | "cancelada" | "concluida"
    status: str = "agendada"
    returned_at: Optional[str] = None


class RequestCreate(RequestBase):
    pass


class RequestUpdate(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    boat_name: Optional[str] = None
    expected_return_date: Optional[str] = None
    expected_return_time: Optional[str] = None
    destination: Optional[str] = None
    passengers: Optional[int] = None
    responsible: Optional[str] = None
    observation: Optional[str] = None
    tide_height: Optional[float] = None


class RequestOut(RequestBase):
    id: str
    user_name: Optional[str] = None
    boat_name: Optional[str] = None
    created_at: str
    updated_at: str


# ===================== Validation =====================
SLOT_CAPACITY = 3


def generate_slots(req_type: str) -> List[str]:
    """Half-hour slots within allowed range for the given type."""
    start = DESCIDA_MIN if req_type == "descida" else SUBIDA_MIN
    end = DESCIDA_MAX if req_type == "descida" else SUBIDA_MAX
    slots = []
    cur = start.hour * 60 + start.minute
    last = end.hour * 60 + end.minute
    while cur <= last:
        slots.append(f"{cur // 60:02d}:{cur % 60:02d}")
        cur += 30
    return slots


def is_unlimited_slot(req_type: str, hhmm: str) -> bool:
    """Subida at 17:30 has no capacity limit."""
    return req_type == "subida" and hhmm == "17:30"


async def slot_count(req_type: str, date: str, hhmm: str, exclude_id: Optional[str] = None) -> int:
    query = {"type": req_type, "date": date, "time": hhmm, "status": {"$ne": "cancelada"}}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    return await db.requests.count_documents(query)


async def next_available_slot(req_type: str, date: str, from_time: str) -> Optional[str]:
    slots = generate_slots(req_type)
    try:
        start_idx = slots.index(from_time)
    except ValueError:
        start_idx = 0
    for s in slots[start_idx:]:
        if is_unlimited_slot(req_type, s):
            return s
        if await slot_count(req_type, date, s) < SLOT_CAPACITY:
            return s
    return None


async def enforce_capacity(payload: RequestBase, exclude_id: Optional[str] = None):
    if is_unlimited_slot(payload.type, payload.time):
        return
    count = await slot_count(payload.type, payload.date, payload.time, exclude_id)
    if count >= SLOT_CAPACITY:
        nxt = await next_available_slot(payload.type, payload.date, payload.time)
        suffix = f" Próximo horário disponível: {nxt}." if nxt else " Não há horários disponíveis neste dia."
        raise HTTPException(
            status_code=409,
            detail=f"Horário {payload.time} lotado (limite de {SLOT_CAPACITY} lanchas).{suffix}",
        )


def validate_request_payload(payload: RequestBase):
    t = parse_hhmm(payload.time)
    if not t:
        raise HTTPException(status_code=400, detail="Horário inválido. Use HH:MM.")

    if t.minute not in (0, 30):
        raise HTTPException(status_code=400, detail="Horário deve ser de meia em meia hora (ex.: 08:30, 09:00).")

    if payload.type == "descida":
        if not (DESCIDA_MIN <= t <= DESCIDA_MAX):
            raise HTTPException(
                status_code=400,
                detail="Horário da descida deve estar entre 08:30 e 17:00.",
            )
        # Required fields for descida
        missing = []
        if not payload.expected_return_date:
            missing.append("Data de retorno")
        if not payload.expected_return_time:
            missing.append("Hora de retorno")
        if not payload.destination:
            missing.append("Destino")
        if payload.passengers is None or payload.passengers <= 0:
            missing.append("Número de passageiros")
        if not payload.responsible:
            missing.append("Responsável")
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Campos obrigatórios: {', '.join(missing)}",
            )
    else:  # subida
        if not (SUBIDA_MIN <= t <= SUBIDA_MAX):
            raise HTTPException(
                status_code=400,
                detail="Horário da subida deve estar entre 08:30 e 17:30.",
            )


# ===================== Routes =====================
@api_router.get("/")
async def root():
    return {"message": "Marina Pararanga API"}


@api_router.post("/login")
async def login(payload: LoginInput):
    cpf = normalize_cpf(payload.cpf)
    if len(cpf) != 11:
        raise HTTPException(status_code=400, detail="CPF inválido. Digite os 11 dígitos.")
    user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="CPF não cadastrado.")
    return user


@api_router.get("/users/{cpf}")
async def get_user(cpf: str):
    cpf_clean = normalize_cpf(cpf)
    user = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    return user


@api_router.post("/requests", response_model=RequestOut)
async def create_request(payload: RequestCreate):
    payload.cpf = normalize_cpf(payload.cpf)
    validate_request_payload(payload)
    await enforce_capacity(payload)
    user = await db.users.find_one({"cpf": payload.cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="CPF não cadastrado.")

    now_iso = datetime.now(timezone.utc).isoformat()
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_name"] = user["name"]
    doc["boat_name"] = payload.boat_name or user.get("boat_name")
    doc["created_at"] = now_iso
    doc["updated_at"] = now_iso
    await db.requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/requests/today", response_model=List[RequestOut])
async def get_today_requests(type: Optional[str] = None, cpf: Optional[str] = None):
    today = datetime.now().strftime("%Y-%m-%d")
    query = {"date": today}
    if type in ("descida", "subida"):
        query["type"] = type
    if cpf:
        query["cpf"] = normalize_cpf(cpf)
    docs = await db.requests.find(query, {"_id": 0}).sort("time", 1).to_list(500)
    return docs


@api_router.get("/requests/history", response_model=List[RequestOut])
async def get_history(cpf: str):
    """All requests of a given user, most recent first."""
    query = {"cpf": normalize_cpf(cpf)}
    docs = (
        await db.requests.find(query, {"_id": 0})
        .sort([("date", -1), ("time", -1)])
        .to_list(1000)
    )
    return docs


@api_router.get("/requests/day", response_model=List[RequestOut])
async def get_day_requests(date: Optional[str] = None, type: Optional[str] = None):
    """All requests for a specific day (admin panel). Defaults to today."""
    day = date or datetime.now().strftime("%Y-%m-%d")
    query = {"date": day}
    if type in ("descida", "subida"):
        query["type"] = type
    docs = await db.requests.find(query, {"_id": 0}).sort("time", 1).to_list(1000)
    return docs


@api_router.get("/slots")
async def get_slots(type: str, date: str):
    """Availability of half-hour slots for a type/date."""
    if type not in ("descida", "subida"):
        raise HTTPException(status_code=400, detail="Tipo inválido.")
    result = []
    for s in generate_slots(type):
        count = await slot_count(type, date, s)
        unlimited = is_unlimited_slot(type, s)
        result.append({
            "time": s,
            "count": count,
            "capacity": None if unlimited else SLOT_CAPACITY,
            "available": True if unlimited else count < SLOT_CAPACITY,
            "unlimited": unlimited,
        })
    return result


@api_router.get("/requests/{request_id}", response_model=RequestOut)
async def get_request(request_id: str):
    doc = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return doc


@api_router.put("/requests/{request_id}", response_model=RequestOut)
async def update_request(request_id: str, payload: RequestUpdate):
    existing = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    update_data = {k: v for k, v in payload.dict().items() if v is not None}
    merged = {**existing, **update_data}
    # Re-validate merged
    revalidated = RequestBase(**{k: merged.get(k) for k in RequestBase.__fields__.keys()})
    validate_request_payload(revalidated)
    await enforce_capacity(revalidated, exclude_id=request_id)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.requests.update_one({"id": request_id}, {"$set": update_data})
    doc = await db.requests.find_one({"id": request_id}, {"_id": 0})
    return doc


@api_router.patch("/requests/{request_id}/cancel", response_model=RequestOut)
async def cancel_request(request_id: str):
    existing = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"status": "cancelada", "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return await db.requests.find_one({"id": request_id}, {"_id": 0})


@api_router.patch("/requests/{request_id}/confirm-return", response_model=RequestOut)
async def confirm_return(request_id: str):
    existing = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"status": "concluida", "returned_at": now_iso, "updated_at": now_iso}},
    )
    return await db.requests.find_one({"id": request_id}, {"_id": 0})


@api_router.patch("/requests/{request_id}/complete", response_model=RequestOut)
async def complete_request(request_id: str):
    """Admin marks a descida/subida as completed (concluída)."""
    existing = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"status": "concluida", "returned_at": now_iso, "updated_at": now_iso}},
    )
    return await db.requests.find_one({"id": request_id}, {"_id": 0})


@api_router.delete("/requests/{request_id}")
async def delete_request(request_id: str):
    res = await db.requests.delete_one({"id": request_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return {"ok": True}


# ===================== Tide (TábuaMaré API) =====================
def _flatten_tide_points(payload) -> List[dict]:
    """Extract {time, height} points from the TábuaMaré response (defensive)."""
    result = []

    def walk(node):
        if isinstance(node, dict):
            hour = node.get("hour") or node.get("time") or node.get("hora")
            level = node.get("level")
            if level is None:
                level = node.get("height") if "height" in node else node.get("altura")
            if hour is not None and level is not None:
                try:
                    h = str(hour)[:5]
                    if len(h) == 4:  # e.g. 3:12 -> pad
                        h = "0" + h
                    height = float(str(level).replace(",", "."))
                    result.append({"time": h, "height": height})
                except (TypeError, ValueError):
                    pass
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(payload)
    # de-duplicate by time, keep order
    seen = {}
    for p in result:
        seen[p["time"]] = p
    return sorted(seen.values(), key=lambda x: x["time"])


async def fetch_tabuamare(date: str) -> List[dict]:
    """Fetch tide points for a date from TábuaMaré, with Mongo cache per date."""
    cached = await db.tide_cache.find_one({"date": date}, {"_id": 0})
    if cached and cached.get("points"):
        return cached["points"]

    try:
        parsed = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        return []

    url = f"{TABUAMARE_BASE}/tabua-mare/{TABUAMARE_HARBOR}/{parsed.month}/{parsed.day}"
    headers = {}
    if TABUAMARE_API_KEY:
        headers["Authorization"] = f"Bearer {TABUAMARE_API_KEY}"
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            resp = await http.get(url, headers=headers)
        if resp.status_code >= 400:
            logger.warning("TábuaMaré HTTP %s for %s", resp.status_code, date)
            return []
        points = _flatten_tide_points(resp.json())
    except Exception as exc:  # noqa
        logger.warning("TábuaMaré fetch failed: %s", exc)
        return []

    if points:
        await db.tide_cache.update_one(
            {"date": date},
            {"$set": {"date": date, "harbor": TABUAMARE_HARBOR, "points": points,
                      "fetched_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    return points


@api_router.get("/tides/{date}")
async def get_tides(date: str):
    """Tide points (metros) for São Sebastião-SP on a given day (cached)."""
    points = await fetch_tabuamare(date)
    return {"date": date, "harbor": TABUAMARE_HARBOR, "points": points}


# ===================== Client / boat management (admin) =====================
class ClientInput(BaseModel):
    cpf: str
    name: str
    phone: str
    boats: List[str] = []


class BoatInput(BaseModel):
    boat: str


@api_router.get("/users", response_model=List[User])
async def list_users():
    docs = await db.users.find({"is_admin": {"$ne": True}}, {"_id": 0}).sort("name", 1).to_list(1000)
    return docs


@api_router.post("/users", response_model=User)
async def create_client(payload: ClientInput):
    cpf = normalize_cpf(payload.cpf)
    if len(cpf) != 11:
        raise HTTPException(status_code=400, detail="CPF inválido. Digite os 11 dígitos.")
    existing = await db.users.find_one({"cpf": cpf})
    if existing:
        raise HTTPException(status_code=409, detail="CPF já cadastrado.")
    boats = [b.strip() for b in payload.boats if b.strip()]
    doc = {
        "cpf": cpf,
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "boat_name": boats[0] if boats else "",
        "boats": boats,
        "is_admin": False,
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.post("/users/{cpf}/boats", response_model=User)
async def add_boat(cpf: str, payload: BoatInput):
    cpf_clean = normalize_cpf(cpf)
    user = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    boat = payload.boat.strip()
    if not boat:
        raise HTTPException(status_code=400, detail="Nome da lancha é obrigatório.")
    boats = user.get("boats", [])
    if boat in boats:
        raise HTTPException(status_code=409, detail="Lancha já cadastrada.")
    boats.append(boat)
    update = {"boats": boats}
    if not user.get("boat_name"):
        update["boat_name"] = boat
    await db.users.update_one({"cpf": cpf_clean}, {"$set": update})
    return await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})


@api_router.delete("/users/{cpf}/boats", response_model=User)
async def remove_boat(cpf: str, boat: str):
    cpf_clean = normalize_cpf(cpf)
    user = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    boats = [b for b in user.get("boats", []) if b != boat]
    update = {"boats": boats}
    if user.get("boat_name") == boat:
        update["boat_name"] = boats[0] if boats else ""
    await db.users.update_one({"cpf": cpf_clean}, {"$set": update})
    return await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})


# ===================== Seed =====================
SEED_USERS = [
    {"cpf": "11111111111", "name": "João Silva", "phone": "(48) 99999-1111", "boat_name": "Netuno", "boats": ["Netuno"], "is_admin": False},
    {"cpf": "22222222222", "name": "Maria Santos", "phone": "(48) 99999-2222", "boat_name": "Poseidon", "boats": ["Poseidon", "Sereia", "Vento Sul"], "is_admin": False},
    {"cpf": "33333333333", "name": "Carlos Oliveira", "phone": "(48) 99999-3333", "boat_name": "Aurora", "boats": ["Aurora", "Estrela do Mar"], "is_admin": False},
    {"cpf": "00000000000", "name": "Administração Marina", "phone": "(48) 3000-0000", "boat_name": "Marina Pararanga", "boats": [], "is_admin": True},
]


@app.on_event("startup")
async def seed_users():
    for u in SEED_USERS:
        await db.users.update_one({"cpf": u["cpf"]}, {"$set": u}, upsert=True)


# Include the router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
