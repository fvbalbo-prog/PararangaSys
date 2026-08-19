from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
import httpx
import requests
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, time, date as date_cls, timedelta

BR_TZ = timezone(timedelta(hours=-3))


def now_br() -> datetime:
    return datetime.now(BR_TZ)


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

# ===================== Emergent Object Storage =====================
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "marina-pararanga"
_storage_key = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    global _storage_key
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")



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
class Boat(BaseModel):
    name: str
    draft: Optional[float] = None   # calado em metros
    length: Optional[float] = None  # comprimento em pés


class User(BaseModel):
    cpf: str
    name: str
    phone: str
    boat_name: str
    boats: List[Boat] = []
    is_admin: bool = False
    is_staff: bool = False
    active: bool = True


class LoginInput(BaseModel):
    cpf: str
    phone: Optional[str] = None


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

    # Janela de agendamento: apenas hoje ou amanhã, com no mínimo 1h de antecedência
    try:
        y, mo, d = map(int, payload.date.split("-"))
        req_date = date_cls(y, mo, d)
    except Exception:
        raise HTTPException(status_code=400, detail="Data inválida.")
    now = now_br()
    delta_days = (req_date - now.date()).days
    if delta_days < 0 or delta_days > 1:
        raise HTTPException(
            status_code=400,
            detail="Agendamento permitido apenas para hoje ou amanhã.",
        )
    scheduled = datetime(y, mo, d, t.hour, t.minute, tzinfo=BR_TZ)
    if scheduled - now < timedelta(hours=1):
        acao = "descida" if payload.type == "descida" else "subida"
        raise HTTPException(
            status_code=400,
            detail=f"É necessário solicitar a {acao} com no mínimo 1 hora de antecedência.",
        )

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
    digits = normalize_cpf(payload.cpf)
    phone_digits = re.sub(r"\D", "", payload.phone or "")
    if len(digits) < 5 or len(phone_digits) < 4:
        raise HTTPException(status_code=400, detail="Informe os 5 primeiros dígitos do CPF e os 4 últimos do celular.")
    prefix = digits[:5]
    last4 = phone_digits[-4:]
    candidates = await db.users.find({"cpf": {"$regex": f"^{prefix}"}}, {"_id": 0}).to_list(50)
    for u in candidates:
        up = re.sub(r"\D", "", u.get("phone", ""))
        if up[-4:] == last4:
            if u.get("active") is False:
                raise HTTPException(status_code=403, detail="Acesso desativado. Procure a administração da marina.")
            return u
    raise HTTPException(status_code=404, detail="CPF ou celular não confere.")


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


@api_router.patch("/requests/{request_id}/reopen", response_model=RequestOut)
async def reopen_request(request_id: str):
    """Staff correction: revert a completed request back to 'aguardando'."""
    existing = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"status": "agendada", "returned_at": None, "updated_at": datetime.now(timezone.utc).isoformat()}},
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
    boats: List[Boat] = []
    is_staff: bool = False


class BoatInput(BaseModel):
    name: str
    draft: Optional[float] = None
    length: Optional[float] = None


def _boat_name(b) -> str:
    """Support both legacy string boats and new object boats."""
    return b if isinstance(b, str) else (b.get("name") if isinstance(b, dict) else "")


@api_router.get("/users", response_model=List[User])
async def list_users():
    docs = await db.users.find(
        {"is_admin": {"$ne": True}}, {"_id": 0}
    ).sort("name", 1).to_list(1000)
    # normalize legacy string boats -> objects
    for d in docs:
        d["boats"] = [b if isinstance(b, dict) else {"name": b} for b in d.get("boats", [])]
    return docs


@api_router.post("/users", response_model=User)
async def create_client(payload: ClientInput):
    cpf = normalize_cpf(payload.cpf)
    if len(cpf) != 11:
        raise HTTPException(status_code=400, detail="CPF inválido. Digite os 11 dígitos.")
    existing = await db.users.find_one({"cpf": cpf})
    if existing:
        raise HTTPException(status_code=409, detail="CPF já cadastrado.")
    boats = [b.dict() for b in payload.boats if b.name.strip()]
    doc = {
        "cpf": cpf,
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "boat_name": boats[0]["name"] if boats else "",
        "boats": boats,
        "is_admin": False,
        "is_staff": bool(payload.is_staff),
        "active": True,
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    return doc


class ActiveInput(BaseModel):
    active: bool


@api_router.patch("/users/{cpf}/active", response_model=User)
async def set_user_active(cpf: str, payload: ActiveInput):
    cpf_clean = normalize_cpf(cpf)
    res = await db.users.update_one({"cpf": cpf_clean}, {"$set": {"active": payload.active}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    u = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    u["boats"] = [b if isinstance(b, dict) else {"name": b} for b in u.get("boats", [])]
    return u


@api_router.post("/users/{cpf}/boats", response_model=User)
async def add_boat(cpf: str, payload: BoatInput):
    cpf_clean = normalize_cpf(cpf)
    user = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome da lancha é obrigatório.")
    boats = [b if isinstance(b, dict) else {"name": b} for b in user.get("boats", [])]
    if any(_boat_name(b) == name for b in boats):
        raise HTTPException(status_code=409, detail="Lancha já cadastrada.")
    boats.append({"name": name, "draft": payload.draft, "length": payload.length})
    update = {"boats": boats}
    if not user.get("boat_name"):
        update["boat_name"] = name
    await db.users.update_one({"cpf": cpf_clean}, {"$set": update})
    return await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})


@api_router.delete("/users/{cpf}/boats", response_model=User)
async def remove_boat(cpf: str, boat: str):
    cpf_clean = normalize_cpf(cpf)
    user = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    boats = [b if isinstance(b, dict) else {"name": b} for b in user.get("boats", [])]
    boats = [b for b in boats if _boat_name(b) != boat]
    update = {"boats": boats}
    if user.get("boat_name") == boat:
        update["boat_name"] = _boat_name(boats[0]) if boats else ""
    await db.users.update_one({"cpf": cpf_clean}, {"$set": update})
    return await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})


# ===================== Conveniência (produtos + pedidos) =====================
PRODUCT_CATEGORIES = ["Bebidas", "Sorvetes", "Açaí", "Outros"]


class ProductInput(BaseModel):
    name: str
    price: float
    category: Optional[str] = "Outros"


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    active: Optional[bool] = None
    in_stock: Optional[bool] = None
    category: Optional[str] = None


class OrderItem(BaseModel):
    product_id: str
    name: str
    price: float
    qty: int


class ConvenienceOrderInput(BaseModel):
    cpf: str
    boat_name: Optional[str] = None
    items: List[OrderItem]
    observation: Optional[str] = None


@api_router.get("/products")
async def list_products(all: bool = False):
    query = {} if all else {"active": {"$ne": False}}
    docs = await db.products.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    return docs


@api_router.post("/products")
async def create_product(payload: ProductInput):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome do produto é obrigatório.")
    category = payload.category if payload.category in PRODUCT_CATEGORIES else "Outros"
    doc = {
        "id": str(uuid.uuid4()),
        "name": name,
        "price": float(payload.price),
        "active": True,
        "in_stock": True,
        "category": category,
        "image_url": None,
    }
    await db.products.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/products/{pid}")
async def update_product(pid: str, payload: ProductUpdate):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if "name" in update:
        update["name"] = update["name"].strip()
    if "price" in update:
        update["price"] = float(update["price"])
    if "category" in update and update["category"] not in PRODUCT_CATEGORIES:
        update["category"] = "Outros"
    if not update:
        raise HTTPException(status_code=400, detail="Nada para atualizar.")
    res = await db.products.update_one({"id": pid}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")
    return await db.products.find_one({"id": pid}, {"_id": 0})


@api_router.post("/products/{pid}/image")
async def upload_product_image(pid: str, file: UploadFile = File(...)):
    product = await db.products.find_one({"id": pid}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")
    ext = "jpg"
    if file.filename and "." in file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower()[:5]
    path = f"{APP_NAME}/uploads/products/{uuid.uuid4()}.{ext}"
    content_type = file.content_type or "image/jpeg"
    try:
        await run_in_threadpool(put_object, path, content, content_type)
    except Exception as e:
        logger.error(f"Erro ao subir imagem: {e}")
        raise HTTPException(status_code=502, detail="Falha ao enviar a imagem.")
    image_url = f"/api/files/{path}"
    await db.products.update_one({"id": pid}, {"$set": {"image_url": image_url, "storage_path": path}})
    return await db.products.find_one({"id": pid}, {"_id": 0})


@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    try:
        content, content_type = await run_in_threadpool(get_object, path)
    except Exception as e:
        logger.error(f"Erro ao buscar arquivo {path}: {e}")
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})


@api_router.delete("/products/{pid}")
async def delete_product(pid: str):
    res = await db.products.delete_one({"id": pid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")
    return {"ok": True}


@api_router.post("/convenience/orders")
async def create_order(payload: ConvenienceOrderInput):
    cpf = normalize_cpf(payload.cpf)
    user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="CPF não cadastrado.")
    items = [i for i in payload.items if i.qty > 0]
    if not items:
        raise HTTPException(status_code=400, detail="Selecione ao menos um produto.")
    # Validate products are available (active + in stock)
    for it in items:
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod or prod.get("active") is False:
            raise HTTPException(status_code=400, detail=f"Produto indisponível: {it.name}.")
        if prod.get("in_stock") is False:
            raise HTTPException(status_code=400, detail=f"Sem estoque: {it.name}.")
    total = round(sum(i.price * i.qty for i in items), 2)
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "cpf": cpf,
        "user_name": user["name"],
        "boat_name": payload.boat_name or user.get("boat_name"),
        "items": [i.dict() for i in items],
        "total": total,
        "observation": payload.observation,
        "status": "pendente",
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.convenience_orders.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/convenience/orders")
async def list_orders(cpf: Optional[str] = None):
    query = {"cpf": normalize_cpf(cpf)} if cpf else {}
    docs = await db.convenience_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api_router.patch("/convenience/orders/{oid}/status")
async def set_order_status(oid: str, status: str):
    if status not in ("pendente", "entregue", "cancelada"):
        raise HTTPException(status_code=400, detail="Status inválido.")
    res = await db.convenience_orders.update_one(
        {"id": oid}, {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")
    return await db.convenience_orders.find_one({"id": oid}, {"_id": 0})


# ===================== Autorizar Entrada (autorizar terceiros) =====================
class AuthorizationInput(BaseModel):
    cpf: str
    boat_name: str
    person_name: str
    date: str  # YYYY-MM-DD
    can_lower: bool = False
    service: Optional[str] = None


@api_router.post("/authorizations")
async def create_authorization(payload: AuthorizationInput):
    cpf = normalize_cpf(payload.cpf)
    user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="CPF não cadastrado.")
    if not payload.person_name.strip():
        raise HTTPException(status_code=400, detail="Nome do autorizado é obrigatório.")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "cpf": cpf,
        "user_name": user["name"],
        "boat_name": payload.boat_name,
        "person_name": payload.person_name.strip(),
        "date": payload.date,
        "can_lower": bool(payload.can_lower),
        "service": (payload.service or "").strip() or None,
        "status": "ativa",
        "entered_at": None,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.authorizations.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/authorizations")
async def list_authorizations(cpf: Optional[str] = None):
    query = {"cpf": normalize_cpf(cpf)} if cpf else {}
    docs = await db.authorizations.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api_router.patch("/authorizations/{aid}/cancel")
async def cancel_authorization(aid: str):
    res = await db.authorizations.update_one(
        {"id": aid}, {"$set": {"status": "cancelada", "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Autorização não encontrada.")
    return await db.authorizations.find_one({"id": aid}, {"_id": 0})


@api_router.patch("/authorizations/{aid}/checkin")
async def checkin_authorization(aid: str):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.authorizations.update_one(
        {"id": aid}, {"$set": {"entered_at": now_iso, "updated_at": now_iso}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Autorização não encontrada.")
    return await db.authorizations.find_one({"id": aid}, {"_id": 0})


# ===================== Emergência / Reboque =====================
class EmergencyInput(BaseModel):
    cpf: str
    boat_name: Optional[str] = None
    location: Optional[str] = None
    observation: Optional[str] = None


class ReboqueInput(BaseModel):
    cpf: str
    boat_name: str
    distance_nm: Optional[float] = None
    client_lat: Optional[float] = None
    client_lng: Optional[float] = None
    location: Optional[str] = None
    observation: Optional[str] = None


# Coordenadas da marina (ponto de partida do reboque) — ajustável
MARINA_LAT = float(os.environ.get("MARINA_LAT", "-27.5969"))
MARINA_LNG = float(os.environ.get("MARINA_LNG", "-48.5495"))


def haversine_nm(lat1, lon1, lat2, lon2) -> float:
    from math import radians, sin, cos, asin, sqrt
    r_km = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    km = 2 * r_km * asin(sqrt(a))
    return round(km / 1.852, 2)  # km -> milhas náuticas


class BillInput(BaseModel):
    amount: float


REBOQUE_TABLE = [
    (25, 1200.0, 120.0),   # até 25 pés
    (35, 1800.0, 180.0),   # 26 a 35 pés
    (999, 2500.0, 250.0),  # 36 pés ou mais
]
REBOQUE_INCLUDED_NM = 5.0


def reboque_quote(length_feet: Optional[float], distance_nm: float) -> dict:
    feet = length_feet or 0
    base, per_nm = 2500.0, 250.0
    for max_feet, b, p in REBOQUE_TABLE:
        if feet <= max_feet:
            base, per_nm = b, p
            break
    additional_nm = max(0.0, distance_nm - REBOQUE_INCLUDED_NM)
    additional_fee = round(additional_nm * per_nm, 2)
    total = round(base + additional_fee, 2)
    return {
        "boat_length": length_feet,
        "distance_nm": distance_nm,
        "included_nm": REBOQUE_INCLUDED_NM,
        "additional_nm": additional_nm,
        "base_fee": base,
        "per_nm": per_nm,
        "additional_fee": additional_fee,
        "estimated_total": total,
    }


@api_router.get("/reboque/quote")
async def reboque_quote_endpoint(
    length: float,
    distance: Optional[float] = None,
    client_lat: Optional[float] = None,
    client_lng: Optional[float] = None,
):
    if client_lat is not None and client_lng is not None:
        dist = haversine_nm(MARINA_LAT, MARINA_LNG, client_lat, client_lng)
    elif distance is not None:
        dist = distance
    else:
        raise HTTPException(status_code=400, detail="Informe distância ou coordenadas.")
    return reboque_quote(length, dist)


def _boat_length_for(user: dict, boat_name: Optional[str]) -> Optional[float]:
    for b in user.get("boats", []):
        if isinstance(b, dict) and b.get("name") == boat_name:
            return b.get("length")
    return None


@api_router.post("/emergencies")
async def create_emergency(payload: EmergencyInput):
    cpf = normalize_cpf(payload.cpf)
    user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="CPF não cadastrado.")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "kind": "socorro",
        "cpf": cpf,
        "user_name": user["name"],
        "phone": user.get("phone"),
        "boat_name": payload.boat_name or user.get("boat_name"),
        "location": payload.location,
        "observation": payload.observation,
        "status": "aberta",
        "billed_amount": None,
        "billed_at": None,
        "created_at": now_iso,
        "resolved_at": None,
        "updated_at": now_iso,
    }
    await db.emergencies.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.post("/reboque")
async def create_reboque(payload: ReboqueInput):
    cpf = normalize_cpf(payload.cpf)
    user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="CPF não cadastrado.")
    length = _boat_length_for(user, payload.boat_name)
    if payload.client_lat is not None and payload.client_lng is not None:
        distance = haversine_nm(MARINA_LAT, MARINA_LNG, payload.client_lat, payload.client_lng)
    elif payload.distance_nm is not None:
        distance = payload.distance_nm
    else:
        raise HTTPException(status_code=400, detail="Informe a localização ou a distância.")
    quote = reboque_quote(length, distance)
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "kind": "reboque",
        "cpf": cpf,
        "user_name": user["name"],
        "phone": user.get("phone"),
        "boat_name": payload.boat_name,
        "client_lat": payload.client_lat,
        "client_lng": payload.client_lng,
        "location": payload.location,
        "observation": payload.observation,
        "status": "aberta",
        "billed_amount": None,
        "billed_at": None,
        "created_at": now_iso,
        "resolved_at": None,
        "updated_at": now_iso,
        **quote,
    }
    await db.emergencies.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/emergencies")
async def list_emergencies(cpf: Optional[str] = None, status: Optional[str] = None):
    query = {}
    if cpf:
        query["cpf"] = normalize_cpf(cpf)
    if status:
        query["status"] = status
    docs = await db.emergencies.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api_router.patch("/emergencies/{eid}/bill")
async def bill_emergency(eid: str, payload: BillInput):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.emergencies.update_one(
        {"id": eid},
        {"$set": {"billed_amount": round(float(payload.amount), 2), "billed_at": now_iso, "updated_at": now_iso}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    return await db.emergencies.find_one({"id": eid}, {"_id": 0})


@api_router.patch("/emergencies/{eid}/resolve")
async def resolve_emergency(eid: str):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.emergencies.update_one(
        {"id": eid}, {"$set": {"status": "atendida", "resolved_at": now_iso, "updated_at": now_iso}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Emergência não encontrada.")
    return await db.emergencies.find_one({"id": eid}, {"_id": 0})


# ===================== Relatório de consumo (cobrança mensal) =====================
@api_router.get("/reports/consumo")
async def consumo_report(month: Optional[str] = None, cpf: Optional[str] = None):
    """month = YYYY-MM. Agrupa por cliente o consumo de conveniência (pedidos
    não cancelados) e reboques faturados (billed_amount) no mês."""
    if not month:
        now = datetime.now(timezone.utc)
        month = f"{now.year}-{now.month:02d}"

    order_q = {"status": {"$ne": "cancelada"}, "created_at": {"$regex": f"^{month}"}}
    reboque_q = {"kind": "reboque", "billed_amount": {"$ne": None}, "billed_at": {"$regex": f"^{month}"}}
    if cpf:
        c = normalize_cpf(cpf)
        order_q["cpf"] = c
        reboque_q["cpf"] = c
    orders = await db.convenience_orders.find(order_q, {"_id": 0}).to_list(5000)
    reboques = await db.emergencies.find(reboque_q, {"_id": 0}).to_list(5000)

    by_client: dict = {}

    def bucket(cpf, name):
        if cpf not in by_client:
            by_client[cpf] = {
                "cpf": cpf,
                "name": name,
                "convenience_total": 0.0,
                "reboque_total": 0.0,
                "total": 0.0,
                "orders": [],
                "reboques": [],
            }
        return by_client[cpf]

    for o in orders:
        b = bucket(o["cpf"], o.get("user_name", ""))
        b["convenience_total"] = round(b["convenience_total"] + o.get("total", 0), 2)
        b["orders"].append(
            {
                "id": o["id"],
                "total": o.get("total", 0),
                "created_at": o.get("created_at"),
                "items": o.get("items", []),
                "status": o.get("status"),
            }
        )
    for r in reboques:
        b = bucket(r["cpf"], r.get("user_name", ""))
        amt = r.get("billed_amount") or 0
        b["reboque_total"] = round(b["reboque_total"] + amt, 2)
        b["reboques"].append(
            {"id": r["id"], "amount": amt, "boat_name": r.get("boat_name"), "billed_at": r.get("billed_at")}
        )

    result = []
    for b in by_client.values():
        b["total"] = round(b["convenience_total"] + b["reboque_total"], 2)
        result.append(b)
    result.sort(key=lambda x: x["total"], reverse=True)
    grand_total = round(sum(b["total"] for b in result), 2)
    return {"month": month, "grand_total": grand_total, "clients": result}


# ===================== Fatura / Notificação de cobrança (in-app) =====================
class StatementSend(BaseModel):
    cpf: str
    month: str  # YYYY-MM


@api_router.post("/statements/send")
async def send_statement(payload: StatementSend):
    cpf = normalize_cpf(payload.cpf)
    user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    report = await consumo_report(month=payload.month, cpf=cpf)
    client = report["clients"][0] if report["clients"] else {
        "convenience_total": 0.0, "reboque_total": 0.0, "total": 0.0, "orders": [], "reboques": []
    }
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "cpf": cpf,
        "user_name": user["name"],
        "month": payload.month,
        "convenience_total": client["convenience_total"],
        "reboque_total": client["reboque_total"],
        "total": client["total"],
        "orders": client["orders"],
        "reboques": client["reboques"],
        "read": False,
        "sent_at": now_iso,
    }
    # substitui notificação anterior do mesmo mês
    await db.statements.delete_many({"cpf": cpf, "month": payload.month})
    await db.statements.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/statements")
async def list_statements(cpf: Optional[str] = None):
    query = {"cpf": normalize_cpf(cpf)} if cpf else {}
    docs = await db.statements.find(query, {"_id": 0}).sort("sent_at", -1).to_list(500)
    return docs


@api_router.patch("/statements/{sid}/read")
async def read_statement(sid: str):
    await db.statements.update_one({"id": sid}, {"$set": {"read": True}})
    return {"ok": True}


# ===================== Seed =====================
SEED_PRODUCTS = [
    {"id": "seed-gelo", "name": "Gelo (saco 5kg)", "price": 15.0, "active": True, "in_stock": True, "category": "Outros", "image_url": None},
    {"id": "seed-agua", "name": "Água mineral (fardo 12un)", "price": 24.0, "active": True, "in_stock": True, "category": "Bebidas", "image_url": None},
    {"id": "seed-refri", "name": "Refrigerante (lata)", "price": 6.0, "active": True, "in_stock": True, "category": "Bebidas", "image_url": None},
    {"id": "seed-cerveja", "name": "Cerveja (lata)", "price": 8.0, "active": True, "in_stock": True, "category": "Bebidas", "image_url": None},
    {"id": "seed-salgadinho", "name": "Salgadinho", "price": 12.0, "active": True, "in_stock": True, "category": "Outros", "image_url": None},
    {"id": "seed-protetor", "name": "Protetor solar", "price": 45.0, "active": True, "in_stock": True, "category": "Outros", "image_url": None},
    {"id": "seed-picole", "name": "Picolé", "price": 7.0, "active": True, "in_stock": True, "category": "Sorvetes", "image_url": None},
    {"id": "seed-acai", "name": "Açaí 300ml", "price": 18.0, "active": True, "in_stock": True, "category": "Açaí", "image_url": None},
]

SEED_USERS = [
    {"cpf": "11111111111", "name": "João Silva", "phone": "(48) 99999-1111", "boat_name": "Netuno",
     "boats": [{"name": "Netuno", "draft": 0.8, "length": 22}], "is_admin": False},
    {"cpf": "22222222222", "name": "Maria Santos", "phone": "(48) 99999-2222", "boat_name": "Poseidon",
     "boats": [{"name": "Poseidon", "draft": 1.1, "length": 32}, {"name": "Sereia", "draft": 0.9, "length": 26}, {"name": "Vento Sul", "draft": 1.0, "length": 28}], "is_admin": False},
    {"cpf": "33333333333", "name": "Carlos Oliveira", "phone": "(48) 99999-3333", "boat_name": "Aurora",
     "boats": [{"name": "Aurora", "draft": 1.2, "length": 34}, {"name": "Estrela do Mar", "draft": 0.7, "length": 24}], "is_admin": False},
    {"cpf": "00000000000", "name": "Administração Marina", "phone": "(48) 3000-0000", "boat_name": "Marina Pararanga",
     "boats": [], "is_admin": True, "is_staff": False},
    {"cpf": "55555555555", "name": "Funcionário Marina", "phone": "(48) 3000-0055", "boat_name": "",
     "boats": [], "is_admin": False, "is_staff": True},
]


@app.on_event("startup")
async def seed_users():
    for u in SEED_USERS:
        await db.users.update_one({"cpf": u["cpf"]}, {"$set": u}, upsert=True)
    for p in SEED_PRODUCTS:
        on_insert = {k: v for k, v in p.items() if k != "category"}
        await db.products.update_one(
            {"id": p["id"]},
            {"$setOnInsert": on_insert, "$set": {"category": p["category"]}},
            upsert=True,
        )
    # Backfill legacy products missing new fields
    await db.products.update_many({"in_stock": {"$exists": False}}, {"$set": {"in_stock": True}})
    await db.products.update_many({"category": {"$exists": False}}, {"$set": {"category": "Outros"}})
    await db.products.update_many({"image_url": {"$exists": False}}, {"$set": {"image_url": None}})
    # Init object storage (non-blocking)
    try:
        await run_in_threadpool(init_storage)
    except Exception as e:
        logger.warning(f"Storage init falhou (tentará no primeiro upload): {e}")


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
