from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Depends, Header
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
import jwt
import secrets
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

# Logger is configured up-front (previously declared near the bottom of this
# file, after routes that already referenced it — harmless at runtime since
# module-level code all runs before any request, but confusing to read and
# fragile to reorder).
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

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


# ===================== Auth (JWT) =====================
# Minimal session layer: /login issues a signed token carrying cpf/is_admin/
# is_staff; the frontend stores it alongside the user object it already
# persists and sends it back as "Authorization: Bearer <token>". Endpoints
# that only the marina's staff/admin should reach are gated with
# require_admin / require_staff below. Endpoints reachable by any logged-in
# client (booking, cancelling, ordering, etc.) are intentionally left open in
# this pass — see ANALISE_ESTRUTURA.md for the follow-up items.
JWT_SECRET = os.environ.get("JWT_SECRET", "").strip()
if not JWT_SECRET:
    # Random per-process secret rather than a fixed fallback: anyone who reads
    # this source (it's public) would otherwise be able to forge admin tokens
    # against any instance that forgets to set JWT_SECRET. The tradeoff is
    # that restarting the process invalidates all existing sessions, which is
    # acceptable outside of production and forces production to set the
    # env var instead of silently running on a guessable key.
    JWT_SECRET = secrets.token_hex(32)
    logger.warning(
        "JWT_SECRET não definido — usando chave aleatória gerada para este "
        "processo (sessões existentes invalidam a cada restart). Defina "
        "JWT_SECRET em produção para manter sessões estáveis entre deploys."
    )
JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 30


def create_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "cpf": user.get("cpf"),
        "is_admin": bool(user.get("is_admin")),
        "is_staff": bool(user.get("is_staff")),
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_claims(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Não autenticado. Faça login novamente.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada. Faça login novamente.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Sessão inválida. Faça login novamente.")


async def require_admin(claims: dict = Depends(get_current_claims)) -> dict:
    if not claims.get("is_admin"):
        raise HTTPException(status_code=403, detail="Acesso restrito à administração da marina.")
    return claims


async def require_staff(claims: dict = Depends(get_current_claims)) -> dict:
    if not (claims.get("is_admin") or claims.get("is_staff")):
        raise HTTPException(status_code=403, detail="Acesso restrito à equipe da marina.")
    return claims


# ===================== Models =====================
class Boat(BaseModel):
    name: str
    draft: Optional[float] = None   # calado em metros
    length: Optional[float] = None  # comprimento em pés
    monthly_fee: Optional[float] = None            # valor da mensalidade (R$)
    monthly_fee_valid_until: Optional[str] = None  # validade do valor, YYYY-MM-DD
    mensalidade_due_day: Optional[int] = None      # dia do mês (1-31) de vencimento da mensalidade


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
    """Fast-fail pre-check: gives a friendly error (with the next open slot)
    in the common case. Not race-proof by itself — two requests can both pass
    this check for the same slot before either finishes inserting — so it's
    paired with reconcile_slot_capacity() after the write actually lands."""
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


async def reconcile_slot_capacity(req_type: str, date: str, hhmm: str, request_id: str) -> bool:
    """Post-write guard against the race enforce_capacity can't close on its
    own (standalone MongoDB here has no multi-document transactions to make
    the earlier check-then-insert atomic). After a request is written into a
    slot, re-read every active request in that exact slot ordered by
    (created_at, id) and keep only the first SLOT_CAPACITY. If `request_id`
    lost that tie-break, it's auto-cancelled and the caller should report a
    409 — this bounds the overbooking window to "briefly visible", never
    permanent, without needing a replica-set transaction."""
    if is_unlimited_slot(req_type, hhmm):
        return True
    docs = await db.requests.find(
        {"type": req_type, "date": date, "time": hhmm, "status": {"$ne": "cancelada"}},
        {"_id": 0, "id": 1, "created_at": 1},
    ).sort([("created_at", 1), ("id", 1)]).to_list(50)
    keep_ids = {d["id"] for d in docs[:SLOT_CAPACITY]}
    if request_id in keep_ids:
        return True
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": "cancelada",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "auto_cancelled_reason": "slot_full_race",
        }},
    )
    return False


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
async def create_notification(cpf: str, title: str, body: str, kind: str = "info"):
    """In-app notification for a client (no push)."""
    doc = {
        "id": str(uuid.uuid4()),
        "cpf": normalize_cpf(cpf),
        "title": title,
        "body": body,
        "kind": kind,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.notifications.insert_one(doc)


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
            u["token"] = create_token(u)
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
    ok = await reconcile_slot_capacity(payload.type, payload.date, payload.time, doc["id"])
    if not ok:
        nxt = await next_available_slot(payload.type, payload.date, payload.time)
        suffix = f" Próximo horário disponível: {nxt}." if nxt else " Não há horários disponíveis neste dia."
        raise HTTPException(
            status_code=409,
            detail=f"Horário {payload.time} lotado (limite de {SLOT_CAPACITY} lanchas).{suffix}",
        )
    doc.pop("_id", None)
    return doc


@api_router.get("/requests/today", response_model=List[RequestOut])
async def get_today_requests(type: Optional[str] = None, cpf: Optional[str] = None):
    today = now_br().strftime("%Y-%m-%d")
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
    day = date or now_br().strftime("%Y-%m-%d")
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

    # exclude_unset (not "filter out None") so a field explicitly sent as
    # null actually clears it — filtering on `v is not None` made it
    # impossible to ever erase e.g. an observation via PUT, since an omitted
    # field and an intentionally-cleared field looked identical.
    update_data = payload.dict(exclude_unset=True)
    merged = {**existing, **update_data}
    # Re-validate merged
    revalidated = RequestBase(**{k: merged.get(k) for k in RequestBase.__fields__.keys()})
    validate_request_payload(revalidated)
    await enforce_capacity(revalidated, exclude_id=request_id)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.requests.update_one({"id": request_id}, {"$set": update_data})
    if "time" in update_data or "date" in update_data:
        ok = await reconcile_slot_capacity(revalidated.type, revalidated.date, revalidated.time, request_id)
        if not ok:
            nxt = await next_available_slot(revalidated.type, revalidated.date, revalidated.time)
            suffix = f" Próximo horário disponível: {nxt}." if nxt else " Não há horários disponíveis neste dia."
            raise HTTPException(
                status_code=409,
                detail=f"Horário {revalidated.time} lotado (limite de {SLOT_CAPACITY} lanchas).{suffix}",
            )
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


@api_router.patch("/requests/{request_id}/complete", response_model=RequestOut, dependencies=[Depends(require_staff)])
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
    # Aviso ao cliente
    if existing.get("cpf"):
        boat = existing.get("boat_name") or "sua lancha"
        if existing.get("type") == "descida":
            await create_notification(
                existing["cpf"],
                "Lancha na água! 🌊",
                f"A descida da {boat} foi confirmada. Ela já está na água.",
                "descida",
            )
        else:
            await create_notification(
                existing["cpf"],
                "Lancha no seco 🚤",
                f"A subida da {boat} foi confirmada. Ela já está de volta no seco.",
                "subida",
            )
    return await db.requests.find_one({"id": request_id}, {"_id": 0})


# ===================== Notificações (avisos in-app do cliente) =====================
@api_router.get("/notifications")
async def list_notifications(cpf: str):
    docs = await db.notifications.find(
        {"cpf": normalize_cpf(cpf)}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return docs


@api_router.patch("/notifications/{nid}/read")
async def read_notification(nid: str):
    await db.notifications.update_one({"id": nid}, {"$set": {"read": True}})
    return {"ok": True}


@api_router.post("/notifications/read-all")
async def read_all_notifications(cpf: str):
    await db.notifications.update_many(
        {"cpf": normalize_cpf(cpf), "read": {"$ne": True}}, {"$set": {"read": True}}
    )
    return {"ok": True}


@api_router.patch("/requests/{request_id}/reopen", response_model=RequestOut, dependencies=[Depends(require_staff)])
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
    monthly_fee: Optional[float] = None
    monthly_fee_valid_until: Optional[str] = None
    mensalidade_due_day: Optional[int] = None


class BoatUpdate(BaseModel):
    draft: Optional[float] = None
    length: Optional[float] = None
    monthly_fee: Optional[float] = None
    monthly_fee_valid_until: Optional[str] = None
    mensalidade_due_day: Optional[int] = None


def _boat_name(b) -> str:
    """Support both legacy string boats and new object boats."""
    return b if isinstance(b, str) else (b.get("name") if isinstance(b, dict) else "")


@api_router.get("/users", response_model=List[User], dependencies=[Depends(require_admin)])
async def list_users():
    docs = await db.users.find(
        {"is_admin": {"$ne": True}}, {"_id": 0}
    ).sort("name", 1).to_list(1000)
    # normalize legacy string boats -> objects
    for d in docs:
        d["boats"] = [b if isinstance(b, dict) else {"name": b} for b in d.get("boats", [])]
    return docs


@api_router.post("/users", response_model=User, dependencies=[Depends(require_admin)])
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


@api_router.patch("/users/{cpf}/active", response_model=User, dependencies=[Depends(require_admin)])
async def set_user_active(cpf: str, payload: ActiveInput):
    cpf_clean = normalize_cpf(cpf)
    res = await db.users.update_one({"cpf": cpf_clean}, {"$set": {"active": payload.active}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    u = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    u["boats"] = [b if isinstance(b, dict) else {"name": b} for b in u.get("boats", [])]
    return u


@api_router.post("/users/{cpf}/boats", response_model=User, dependencies=[Depends(require_admin)])
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
    boats.append({
        "name": name,
        "draft": payload.draft,
        "length": payload.length,
        "monthly_fee": payload.monthly_fee,
        "monthly_fee_valid_until": payload.monthly_fee_valid_until,
        "mensalidade_due_day": payload.mensalidade_due_day,
    })
    update = {"boats": boats}
    if not user.get("boat_name"):
        update["boat_name"] = name
    await db.users.update_one({"cpf": cpf_clean}, {"$set": update})
    return await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})


@api_router.put("/users/{cpf}/boats/{name}", response_model=User, dependencies=[Depends(require_admin)])
async def update_boat(cpf: str, name: str, payload: BoatUpdate):
    cpf_clean = normalize_cpf(cpf)
    user = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    boats = [b if isinstance(b, dict) else {"name": b} for b in user.get("boats", [])]
    if not any(_boat_name(b) == name for b in boats):
        raise HTTPException(status_code=404, detail="Lancha não encontrada.")
    updates = payload.dict(exclude_unset=True)
    for b in boats:
        if _boat_name(b) == name:
            b.update(updates)
    await db.users.update_one({"cpf": cpf_clean}, {"$set": {"boats": boats}})
    return await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})


@api_router.delete("/users/{cpf}/boats", response_model=User, dependencies=[Depends(require_admin)])
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


@api_router.get("/users/mensalidades/vencendo", dependencies=[Depends(require_admin)])
async def mensalidades_vencendo(days: int = 30):
    """Lanchas cujo valor de mensalidade vence dentro de `days` dias (padrão 30
    — avisa o admin com 1 mês de antecedência), incluindo as já vencidas, para
    que o valor seja revisto/renovado. Calculado sob demanda, sem agendador."""
    today = now_br().date()
    limit = today + timedelta(days=days)
    users = await db.users.find({"is_staff": {"$ne": True}}, {"_id": 0}).to_list(2000)
    result = []
    for u in users:
        for b in u.get("boats", []):
            if not isinstance(b, dict):
                continue
            valid_until = b.get("monthly_fee_valid_until")
            if not valid_until:
                continue
            try:
                due = date_cls.fromisoformat(valid_until)
            except ValueError:
                continue
            if due <= limit:
                result.append({
                    "cpf": u["cpf"],
                    "client_name": u["name"],
                    "boat_name": b.get("name"),
                    "monthly_fee": b.get("monthly_fee"),
                    "valid_until": valid_until,
                    "days_remaining": (due - today).days,
                })
    result.sort(key=lambda x: x["valid_until"])
    return result


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
    delivery_method: Optional[str] = "balcao"  # "balcao" | "lancha"


@api_router.get("/products")
async def list_products(all: bool = False):
    query = {} if all else {"active": {"$ne": False}}
    docs = await db.products.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    return docs


@api_router.post("/products", dependencies=[Depends(require_admin)])
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


@api_router.put("/products/{pid}", dependencies=[Depends(require_admin)])
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


@api_router.post("/products/{pid}/image", dependencies=[Depends(require_admin)])
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
    # This is a public, unauthenticated proxy in front of shared object
    # storage — without this prefix check, `path` was passed straight
    # through, so any caller could probe/read any object in that storage
    # account, not just this app's own uploads.
    if ".." in path or not path.startswith(f"{APP_NAME}/uploads/"):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    try:
        content, content_type = await run_in_threadpool(get_object, path)
    except Exception as e:
        logger.error(f"Erro ao buscar arquivo {path}: {e}")
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})


@api_router.delete("/products/{pid}", dependencies=[Depends(require_admin)])
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
        "delivery_method": payload.delivery_method if payload.delivery_method in ("balcao", "lancha") else "balcao",
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


@api_router.patch("/convenience/orders/{oid}/status", dependencies=[Depends(require_staff)])
async def set_order_status(oid: str, status: str):
    if status not in ("pendente", "em_preparo", "pronto", "entregue", "cancelada"):
        raise HTTPException(status_code=400, detail="Status inválido.")
    res = await db.convenience_orders.update_one(
        {"id": oid}, {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")
    return await db.convenience_orders.find_one({"id": oid}, {"_id": 0})


@api_router.get("/reports/weekly", dependencies=[Depends(require_admin)])
async def weekly_report():
    """Últimos 7 dias: contagem de movimentações e faturamento (conveniência + reboque) por dia."""
    today = datetime.now(timezone.utc).date()
    days = [(today - timedelta(days=i)) for i in range(6, -1, -1)]
    day_iso = [d.isoformat() for d in days]

    requests = await db.requests.find({"status": {"$ne": "cancelada"}}, {"_id": 0, "date": 1}).to_list(5000)
    orders = await db.convenience_orders.find({"status": {"$ne": "cancelada"}}, {"_id": 0, "created_at": 1, "total": 1}).to_list(5000)
    emgs = await db.emergencies.find({"kind": "reboque", "billed_amount": {"$ne": None}}, {"_id": 0, "billed_at": 1, "billed_amount": 1}).to_list(5000)

    result = []
    for iso in day_iso:
        movements = sum(1 for r in requests if (r.get("date") or "") == iso)
        conv = sum(o.get("total", 0) for o in orders if (o.get("created_at") or "").startswith(iso))
        reb = sum(e.get("billed_amount", 0) or 0 for e in emgs if (e.get("billed_at") or "").startswith(iso))
        d = datetime.fromisoformat(iso).date()
        result.append({
            "date": iso,
            "label": ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][d.weekday()],
            "movements": movements,
            "revenue": round(conv + reb, 2),
        })
    return result


# ===================== Autorizar Entrada (autorizar terceiros) =====================
class AuthorizationInput(BaseModel):
    cpf: str
    boat_name: str
    person_name: str
    # "data" (data única) | "periodo" (intervalo) | "recorrente" (sem validade)
    validity_type: str = "data"
    date: Optional[str] = None        # para "data"
    start_date: Optional[str] = None  # para "periodo"
    end_date: Optional[str] = None    # para "periodo"
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
    vtype = payload.validity_type if payload.validity_type in ("data", "periodo", "recorrente") else "data"
    date_val = payload.date
    start_date = None
    end_date = None
    if vtype == "data":
        if not payload.date:
            raise HTTPException(status_code=400, detail="Informe a data da autorização.")
    elif vtype == "periodo":
        if not payload.start_date or not payload.end_date:
            raise HTTPException(status_code=400, detail="Informe a data inicial e final do período.")
        if payload.end_date < payload.start_date:
            raise HTTPException(status_code=400, detail="A data final deve ser igual ou posterior à inicial.")
        start_date = payload.start_date
        end_date = payload.end_date
        date_val = payload.start_date  # compat: usado por telas antigas
    else:  # recorrente
        # sem validade: recorrente até o cliente cancelar
        date_val = None
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "cpf": cpf,
        "user_name": user["name"],
        "boat_name": payload.boat_name,
        "person_name": payload.person_name.strip(),
        "validity_type": vtype,
        "date": date_val,
        "start_date": start_date,
        "end_date": end_date,
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


@api_router.patch("/authorizations/{aid}/checkin", dependencies=[Depends(require_staff)])
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
MARINA_LAT = float(os.environ.get("MARINA_LAT", "-23.7980368"))
MARINA_LNG = float(os.environ.get("MARINA_LNG", "-45.3986618"))


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


@api_router.patch("/emergencies/{eid}/bill", dependencies=[Depends(require_admin)])
async def bill_emergency(eid: str, payload: BillInput):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.emergencies.update_one(
        {"id": eid},
        {"$set": {"billed_amount": round(float(payload.amount), 2), "billed_at": now_iso, "updated_at": now_iso}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    return await db.emergencies.find_one({"id": eid}, {"_id": 0})


@api_router.patch("/emergencies/{eid}/resolve", dependencies=[Depends(require_staff)])
async def resolve_emergency(eid: str):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.emergencies.update_one(
        {"id": eid}, {"$set": {"status": "atendida", "resolved_at": now_iso, "updated_at": now_iso}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Emergência não encontrada.")
    return await db.emergencies.find_one({"id": eid}, {"_id": 0})


@api_router.patch("/emergencies/{eid}/cancel")
async def cancel_emergency(eid: str):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.emergencies.update_one(
        {"id": eid}, {"$set": {"status": "cancelada", "updated_at": now_iso}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return await db.emergencies.find_one({"id": eid}, {"_id": 0})


# ===================== Serviços (lavagem, marinheiro, abastecimento) =====================
SERVICO_TYPES = ("lavagem", "marinheiro", "abastecimento")
SERVICO_LABELS = {
    "lavagem": "Lavagem de Lancha",
    "marinheiro": "Marinheiro",
    "abastecimento": "Abastecimento de Combustível",
}


class ServicoInput(BaseModel):
    cpf: str
    boat_name: Optional[str] = None
    type: Literal["lavagem", "marinheiro", "abastecimento"]
    desired_date: Optional[str] = None  # YYYY-MM-DD
    desired_time: Optional[str] = None  # HH:MM
    observation: Optional[str] = None


@api_router.post("/servicos")
async def create_servico(payload: ServicoInput):
    cpf = normalize_cpf(payload.cpf)
    user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="CPF não cadastrado.")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "cpf": cpf,
        "user_name": user["name"],
        "boat_name": payload.boat_name or user.get("boat_name"),
        "type": payload.type,
        "desired_date": payload.desired_date,
        "desired_time": payload.desired_time,
        "observation": (payload.observation or "").strip() or None,
        "status": "pendente",
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.servicos.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/servicos")
async def list_servicos(cpf: Optional[str] = None, status: Optional[str] = None):
    query: dict = {}
    if cpf:
        query["cpf"] = normalize_cpf(cpf)
    if status:
        query["status"] = status
    return await db.servicos.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


@api_router.patch("/servicos/{sid}/status", dependencies=[Depends(require_staff)])
async def set_servico_status(sid: str, status: Literal["pendente", "em_andamento", "concluido", "cancelado"]):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.servicos.update_one({"id": sid}, {"$set": {"status": status, "updated_at": now_iso}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return await db.servicos.find_one({"id": sid}, {"_id": 0})


@api_router.patch("/servicos/{sid}/cancel")
async def cancel_servico(sid: str):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.servicos.update_one({"id": sid}, {"$set": {"status": "cancelado", "updated_at": now_iso}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return await db.servicos.find_one({"id": sid}, {"_id": 0})


# ===================== Relatório de consumo (cobrança mensal) =====================
@api_router.get("/reports/consumo", dependencies=[Depends(require_admin)])
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


@api_router.post("/statements/send", dependencies=[Depends(require_admin)])
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


# ===================== Fatura mensal (mensalidade + consumo, PDF) =====================
def _is_business_day(d: date_cls) -> bool:
    return d.weekday() < 5  # 0=segunda .. 4=sexta


def _due_date_for_month(due_day: int, year: int, month: int) -> date_cls:
    day = min(max(due_day, 1), _days_in_month(year, month))
    return date_cls(year, month, day)


def _fatura_send_date(due_date: date_cls) -> date_cls:
    """Envio sempre 2 dias antes do vencimento, adiantado para o dia útil
    anterior caso caia em fim de semana."""
    send = due_date - timedelta(days=2)
    while not _is_business_day(send):
        send -= timedelta(days=1)
    return send


def _current_fatura_due_date(due_day: int, today: date_cls) -> date_cls:
    """Vencimento do ciclo de fatura corrente, ancorado no dia de pagamento
    da mensalidade da lancha. Avança pro mês seguinte assim que o
    vencimento do mês atual passa."""
    candidate = _due_date_for_month(due_day, today.year, today.month)
    if today > candidate:
        nxt_month = today.month + 1
        nxt_year = today.year
        if nxt_month > 12:
            nxt_month = 1
            nxt_year += 1
        candidate = _due_date_for_month(due_day, nxt_year, nxt_month)
    return candidate


async def _build_fatura(cpf: str, boat: dict, due_date: date_cls) -> dict:
    """Fecha as despesas do cliente (conveniência + reboques) na mesma janela
    do ciclo de pagamento da mensalidade da lancha, e soma o valor da
    mensalidade junto com as demais despesas."""
    period_end = due_date
    period_start = period_end - timedelta(days=29)
    start_iso = period_start.isoformat()
    end_iso = period_end.isoformat()

    order_q = {
        "cpf": cpf,
        "status": {"$ne": "cancelada"},
        "created_at": {"$gte": start_iso, "$lt": f"{end_iso}T23:59:59.999999"},
    }
    reboque_q = {
        "cpf": cpf,
        "boat_name": boat.get("name"),
        "kind": "reboque",
        "billed_amount": {"$ne": None},
        "billed_at": {"$gte": start_iso, "$lt": f"{end_iso}T23:59:59.999999"},
    }
    orders = await db.convenience_orders.find(order_q, {"_id": 0}).to_list(2000)
    reboques = await db.emergencies.find(reboque_q, {"_id": 0}).to_list(2000)

    convenience_total = round(sum(o.get("total", 0) for o in orders), 2)
    reboque_total = round(sum((r.get("billed_amount") or 0) for r in reboques), 2)
    mensalidade = round(boat.get("monthly_fee") or 0, 2)
    total = round(mensalidade + convenience_total + reboque_total, 2)

    return {
        "boat_name": boat.get("name"),
        "period_start": start_iso,
        "period_end": end_iso,
        "due_date": due_date.isoformat(),
        "mensalidade": mensalidade,
        "convenience_total": convenience_total,
        "reboque_total": reboque_total,
        "total": total,
        "orders": [
            {"id": o["id"], "total": o.get("total", 0), "created_at": o.get("created_at"), "items": o.get("items", [])}
            for o in orders
        ],
        "reboques": [
            {"id": r["id"], "amount": r.get("billed_amount") or 0, "billed_at": r.get("billed_at")}
            for r in reboques
        ],
    }


@api_router.get("/fatura/preview")
async def fatura_preview(cpf: str, boat_name: Optional[str] = None):
    """Prévia da(s) fatura(s) do ciclo corrente do cliente, sem persistir
    nem contar como envio — usada pela tela Minha Fatura."""
    cpf_clean = normalize_cpf(cpf)
    user = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    boats = [b for b in user.get("boats", []) if isinstance(b, dict)]
    if boat_name:
        boats = [b for b in boats if b.get("name") == boat_name]
    today = now_br().date()
    results = []
    for b in boats:
        if not b.get("monthly_fee") or not b.get("mensalidade_due_day"):
            continue
        due_date = _current_fatura_due_date(int(b["mensalidade_due_day"]), today)
        send_date = _fatura_send_date(due_date)
        fatura = await _build_fatura(cpf_clean, b, due_date)
        fatura["send_date"] = send_date.isoformat()
        results.append(fatura)
    return {"cpf": cpf_clean, "user_name": user["name"], "faturas": results}


async def _maybe_send_faturas(cpf: str, user_name: str, boats: list):
    today = now_br().date()
    for b in boats:
        if not isinstance(b, dict) or not b.get("monthly_fee") or not b.get("mensalidade_due_day"):
            continue
        due_date = _current_fatura_due_date(int(b["mensalidade_due_day"]), today)
        send_date = _fatura_send_date(due_date)
        if today < send_date:
            continue
        exists = await db.faturas.find_one(
            {"cpf": cpf, "boat_name": b.get("name"), "due_date": due_date.isoformat()}
        )
        if exists:
            continue
        fatura = await _build_fatura(cpf, b, due_date)
        fatura["id"] = str(uuid.uuid4())
        fatura["cpf"] = cpf
        fatura["user_name"] = user_name
        fatura["read"] = False
        fatura["sent_at"] = datetime.now(timezone.utc).isoformat()
        await db.faturas.insert_one(dict(fatura))
        await create_notification(
            cpf,
            "Fatura disponível",
            f"Sua fatura da lancha {b.get('name')} (venc. {due_date.strftime('%d/%m/%Y')}) já está disponível.",
            kind="fatura",
        )


@api_router.get("/faturas")
async def list_faturas(cpf: Optional[str] = None):
    if cpf:
        cpf_clean = normalize_cpf(cpf)
        user = await db.users.find_one({"cpf": cpf_clean}, {"_id": 0})
        if user:
            await _maybe_send_faturas(cpf_clean, user["name"], user.get("boats") or [])
        query = {"cpf": cpf_clean}
    else:
        query = {}
    docs = await db.faturas.find(query, {"_id": 0}).sort("sent_at", -1).to_list(500)
    return docs


@api_router.patch("/faturas/{fid}/read")
async def read_fatura(fid: str):
    await db.faturas.update_one({"id": fid}, {"$set": {"read": True}})
    return {"ok": True}


# ===================== Ponto Eletrônico =====================
PONTO_TYPES = ("entrada", "saida_almoco", "retorno_almoco", "saida_final")
PONTO_TYPE_LABELS = {
    "entrada": "Entrada",
    "saida_almoco": "Saída Almoço",
    "retorno_almoco": "Retorno Almoço",
    "saida_final": "Saída Final",
}
PONTO_MIN = time(7, 0)
PONTO_MAX = time(19, 30)


class PontoInput(BaseModel):
    type: Literal["entrada", "saida_almoco", "retorno_almoco", "saida_final"]


class PontoUpdate(BaseModel):
    date: Optional[str] = None  # YYYY-MM-DD
    time: Optional[str] = None  # HH:MM


@api_router.post("/ponto")
async def bater_ponto(payload: PontoInput, claims: dict = Depends(require_staff)):
    cpf = claims.get("cpf")
    user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    now = now_br()
    if not (PONTO_MIN <= now.time() <= PONTO_MAX):
        raise HTTPException(
            status_code=400,
            detail=f"Ponto só pode ser registrado entre {PONTO_MIN.strftime('%H:%M')} e {PONTO_MAX.strftime('%H:%M')}.",
        )
    today_str = now.strftime("%Y-%m-%d")
    existing = await db.time_entries.find_one({"cpf": cpf, "date": today_str, "type": payload.type})
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"{PONTO_TYPE_LABELS[payload.type]} já registrada hoje, às {existing['time']}.",
        )
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "cpf": cpf,
        "user_name": user.get("name"),
        "type": payload.type,
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M"),
        "edited": False,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.time_entries.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/ponto")
async def list_ponto(
    cpf: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    claims: dict = Depends(require_staff),
):
    # Staff only sees their own punches; admin can see anyone's (or all, if no cpf given).
    query: dict = {}
    if not claims.get("is_admin"):
        query["cpf"] = claims.get("cpf")
    elif cpf:
        query["cpf"] = normalize_cpf(cpf)
    if date_from or date_to:
        date_q = {}
        if date_from:
            date_q["$gte"] = date_from
        if date_to:
            date_q["$lte"] = date_to
        query["date"] = date_q
    docs = await db.time_entries.find(query, {"_id": 0}).sort([("date", -1), ("time", -1)]).to_list(2000)
    return docs


@api_router.put("/ponto/{pid}", dependencies=[Depends(require_admin)])
async def update_ponto(pid: str, payload: PontoUpdate):
    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat(), "edited": True}
    if payload.date is not None:
        updates["date"] = payload.date
    if payload.time is not None:
        updates["time"] = payload.time
    res = await db.time_entries.update_one({"id": pid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Registro de ponto não encontrado.")
    return await db.time_entries.find_one({"id": pid}, {"_id": 0})


@api_router.delete("/ponto/{pid}", dependencies=[Depends(require_admin)])
async def delete_ponto(pid: str):
    res = await db.time_entries.delete_one({"id": pid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Registro de ponto não encontrado.")
    return {"ok": True}


def _ponto_day_hours(entries_for_day: dict) -> float:
    """entries_for_day: {'entrada': 'HH:MM', 'saida_almoco': ..., ...}. Missing or
    out-of-order pairs (e.g. saída antes da entrada) simply don't count — a
    partial day (esqueceu de bater um ponto) shows less than the real total
    instead of raising, since this feeds a report an admin reads, not a payment
    calculation that must reject bad data outright."""
    def to_min(hhmm):
        if not hhmm:
            return None
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)

    entrada = to_min(entries_for_day.get("entrada"))
    saida_almoco = to_min(entries_for_day.get("saida_almoco"))
    retorno_almoco = to_min(entries_for_day.get("retorno_almoco"))
    saida_final = to_min(entries_for_day.get("saida_final"))
    total = 0
    if entrada is not None and saida_almoco is not None and saida_almoco > entrada:
        total += saida_almoco - entrada
    if retorno_almoco is not None and saida_final is not None and saida_final > retorno_almoco:
        total += saida_final - retorno_almoco
    return round(total / 60, 2)


@api_router.get("/ponto/relatorio", dependencies=[Depends(require_admin)])
async def relatorio_ponto(date_from: str, date_to: str, cpf: Optional[str] = None):
    """Total de horas trabalhadas por funcionário no período, calculado a partir
    dos pares entrada/saída-almoço e retorno-almoço/saída-final de cada dia."""
    query: dict = {"date": {"$gte": date_from, "$lte": date_to}}
    if cpf:
        query["cpf"] = normalize_cpf(cpf)
    docs = await db.time_entries.find(query, {"_id": 0}).to_list(5000)

    by_day: dict = {}
    for d in docs:
        by_day.setdefault((d["cpf"], d["date"]), {})[d["type"]] = d["time"]

    by_employee: dict = {}
    for (c, date), entries in by_day.items():
        hours = _ponto_day_hours(entries)
        b = by_employee.setdefault(c, {"cpf": c, "name": None, "total_hours": 0.0, "days": []})
        b["total_hours"] = round(b["total_hours"] + hours, 2)
        b["days"].append({"date": date, "hours": hours, **entries})

    if by_employee:
        users = await db.users.find({"cpf": {"$in": list(by_employee.keys())}}, {"_id": 0, "cpf": 1, "name": 1}).to_list(len(by_employee))
        names = {u["cpf"]: u["name"] for u in users}
        for c, b in by_employee.items():
            b["name"] = names.get(c, c)

    employees = sorted(by_employee.values(), key=lambda x: x["name"] or "")
    for b in employees:
        b["days"].sort(key=lambda x: x["date"])
    return {"date_from": date_from, "date_to": date_to, "employees": employees}


# ===================== Painel Financeiro (Contas a Pagar / Receber) =====================
FINANCEIRO_CATEGORIES_PAGAR = ["Fornecedores", "Manutenção", "Salários", "Utilidades", "Impostos", "Outros"]
FINANCEIRO_CATEGORIES_RECEBER = ["Mensalidade", "Reboque", "Conveniência", "Serviços", "Outros"]


class FinanceiroInput(BaseModel):
    kind: Literal["pagar", "receber"]
    description: str
    category: str
    amount: float
    due_date: str  # YYYY-MM-DD
    cpf: Optional[str] = None            # receber: cliente vinculado (opcional)
    supplier_name: Optional[str] = None  # pagar: fornecedor (opcional)
    observation: Optional[str] = None
    recurring: bool = False              # ex.: mensalidade da lancha, cobrada todo mês
    recurring_day: Optional[int] = None  # dia do vencimento em cada mês; default = dia de due_date


class FinanceiroUpdate(BaseModel):
    description: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    due_date: Optional[str] = None
    observation: Optional[str] = None


class FinanceiroPay(BaseModel):
    paid_amount: Optional[float] = None  # default: valor integral


@api_router.get("/financeiro/categorias", dependencies=[Depends(require_admin)])
async def financeiro_categorias():
    return {"pagar": FINANCEIRO_CATEGORIES_PAGAR, "receber": FINANCEIRO_CATEGORIES_RECEBER}


def _days_in_month(year: int, month: int) -> int:
    return (date_cls(year + (month == 12), (month % 12) + 1, 1) - timedelta(days=1)).day


@api_router.post("/financeiro", dependencies=[Depends(require_admin)])
async def create_financeiro(payload: FinanceiroInput):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Valor deve ser maior que zero.")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="Descrição é obrigatória.")
    cpf = None
    client_name = None
    if payload.cpf:
        cpf = normalize_cpf(payload.cpf)
        user = await db.users.find_one({"cpf": cpf}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="Cliente não encontrado.")
        client_name = user["name"]
    supplier_name = (payload.supplier_name or "").strip() or None
    now_iso = datetime.now(timezone.utc).isoformat()

    recurring_id = None
    if payload.recurring:
        try:
            due_day = int(payload.due_date.split("-")[2])
        except (IndexError, ValueError):
            raise HTTPException(status_code=400, detail="Data de vencimento inválida.")
        day = payload.recurring_day or due_day
        if not (1 <= day <= 31):
            raise HTTPException(status_code=400, detail="Dia de cobrança deve estar entre 1 e 31.")
        rule = {
            "id": str(uuid.uuid4()),
            "kind": payload.kind,
            "description": payload.description.strip(),
            "category": payload.category,
            "amount": round(payload.amount, 2),
            "day": day,
            "cpf": cpf,
            "client_name": client_name,
            "supplier_name": supplier_name,
            "observation": (payload.observation or "").strip() or None,
            "active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        await db.recorrencias.insert_one(rule)
        recurring_id = rule["id"]

    doc = {
        "id": str(uuid.uuid4()),
        "kind": payload.kind,
        "description": payload.description.strip(),
        "category": payload.category,
        "amount": round(payload.amount, 2),
        "due_date": payload.due_date,
        "cpf": cpf,
        "client_name": client_name,
        "supplier_name": supplier_name,
        "observation": (payload.observation or "").strip() or None,
        "status": "pendente",
        "paid_amount": None,
        "paid_at": None,
        "recurring_id": recurring_id,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.financeiro.insert_one(doc)
    doc.pop("_id", None)
    return doc


def _financeiro_with_display_status(doc: dict) -> dict:
    today = now_br().strftime("%Y-%m-%d")
    doc["status_display"] = "atrasado" if doc["status"] == "pendente" and doc["due_date"] < today else doc["status"]
    return doc


async def _generate_recurring_for_month(month: str):
    """Ensures every active recurring rule has a financeiro entry for `month`
    (YYYY-MM), creating one on the fly if missing. Called whenever that month
    is viewed — there's no background scheduler in this app, so generation is
    lazy instead of cron-driven."""
    year, mon = int(month[:4]), int(month[5:7])
    rules = await db.recorrencias.find({"active": True}, {"_id": 0}).to_list(1000)
    if not rules:
        return
    existing = await db.financeiro.find(
        {"recurring_id": {"$in": [r["id"] for r in rules]}, "due_date": {"$regex": f"^{month}"}},
        {"_id": 0, "recurring_id": 1},
    ).to_list(1000)
    have = {d["recurring_id"] for d in existing}
    now_iso = datetime.now(timezone.utc).isoformat()
    for r in rules:
        if r["id"] in have:
            continue
        day = min(r["day"], _days_in_month(year, mon))
        doc = {
            "id": str(uuid.uuid4()),
            "kind": r["kind"],
            "description": r["description"],
            "category": r["category"],
            "amount": r["amount"],
            "due_date": f"{month}-{day:02d}",
            "cpf": r.get("cpf"),
            "client_name": r.get("client_name"),
            "supplier_name": r.get("supplier_name"),
            "observation": r.get("observation"),
            "status": "pendente",
            "paid_amount": None,
            "paid_at": None,
            "recurring_id": r["id"],
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        await db.financeiro.insert_one(doc)


@api_router.get("/financeiro", dependencies=[Depends(require_admin)])
async def list_financeiro(kind: Optional[str] = None, status: Optional[str] = None, month: Optional[str] = None):
    if month:
        await _generate_recurring_for_month(month)
    query: dict = {}
    if kind:
        query["kind"] = kind
    if month:
        query["due_date"] = {"$regex": f"^{month}"}
    docs = await db.financeiro.find(query, {"_id": 0}).sort("due_date", 1).to_list(5000)
    docs = [_financeiro_with_display_status(d) for d in docs]
    if status:
        docs = [d for d in docs if d["status_display"] == status]
    return docs


@api_router.get("/financeiro/recorrencias", dependencies=[Depends(require_admin)])
async def list_recorrencias(kind: Optional[str] = None):
    query: dict = {"kind": kind} if kind else {}
    return await db.recorrencias.find(query, {"_id": 0}).sort("description", 1).to_list(1000)


@api_router.patch("/financeiro/recorrencias/{rid}/active", dependencies=[Depends(require_admin)])
async def set_recorrencia_active(rid: str, payload: ActiveInput):
    res = await db.recorrencias.update_one(
        {"id": rid},
        {"$set": {"active": payload.active, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Recorrência não encontrada.")
    return await db.recorrencias.find_one({"id": rid}, {"_id": 0})


@api_router.delete("/financeiro/recorrencias/{rid}", dependencies=[Depends(require_admin)])
async def delete_recorrencia(rid: str):
    """Cancela a regra — não afeta os lançamentos já gerados em meses anteriores."""
    res = await db.recorrencias.delete_one({"id": rid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Recorrência não encontrada.")
    return {"ok": True}


@api_router.put("/financeiro/{fid}", dependencies=[Depends(require_admin)])
async def update_financeiro(fid: str, payload: FinanceiroUpdate):
    existing = await db.financeiro.find_one({"id": fid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    updates = payload.dict(exclude_unset=True)
    if "description" in updates:
        if not (updates["description"] or "").strip():
            raise HTTPException(status_code=400, detail="Descrição é obrigatória.")
        updates["description"] = updates["description"].strip()
    if "amount" in updates and updates["amount"] is not None and updates["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Valor deve ser maior que zero.")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.financeiro.update_one({"id": fid}, {"$set": updates})
    return _financeiro_with_display_status(await db.financeiro.find_one({"id": fid}, {"_id": 0}))


@api_router.patch("/financeiro/{fid}/pay", dependencies=[Depends(require_admin)])
async def pay_financeiro(fid: str, payload: FinanceiroPay):
    doc = await db.financeiro.find_one({"id": fid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    now_iso = datetime.now(timezone.utc).isoformat()
    paid_amount = payload.paid_amount if payload.paid_amount is not None else doc["amount"]
    await db.financeiro.update_one(
        {"id": fid},
        {"$set": {"status": "pago", "paid_amount": round(paid_amount, 2), "paid_at": now_iso, "updated_at": now_iso}},
    )
    return _financeiro_with_display_status(await db.financeiro.find_one({"id": fid}, {"_id": 0}))


@api_router.patch("/financeiro/{fid}/reabrir", dependencies=[Depends(require_admin)])
async def reopen_financeiro(fid: str):
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.financeiro.update_one(
        {"id": fid},
        {"$set": {"status": "pendente", "paid_amount": None, "paid_at": None, "updated_at": now_iso}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    return _financeiro_with_display_status(await db.financeiro.find_one({"id": fid}, {"_id": 0}))


@api_router.delete("/financeiro/{fid}", dependencies=[Depends(require_admin)])
async def delete_financeiro(fid: str):
    res = await db.financeiro.delete_one({"id": fid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    return {"ok": True}


@api_router.get("/financeiro/resumo", dependencies=[Depends(require_admin)])
async def resumo_financeiro(month: Optional[str] = None):
    """Totais do mês por status, separados por contas a pagar e a receber, mais
    o saldo previsto (a receber - a pagar, considerando pendentes e atrasados)."""
    if not month:
        now = now_br()
        month = f"{now.year}-{now.month:02d}"
    docs = await db.financeiro.find({"due_date": {"$regex": f"^{month}"}}, {"_id": 0}).to_list(5000)
    today = now_br().strftime("%Y-%m-%d")
    totals = {
        "pagar": {"pendente": 0.0, "atrasado": 0.0, "pago": 0.0},
        "receber": {"pendente": 0.0, "atrasado": 0.0, "pago": 0.0},
    }
    for d in docs:
        bucket = totals[d["kind"]]
        if d["status"] == "pago":
            bucket["pago"] += d.get("paid_amount") if d.get("paid_amount") is not None else d["amount"]
        elif d["due_date"] < today:
            bucket["atrasado"] += d["amount"]
        else:
            bucket["pendente"] += d["amount"]
    for k in totals:
        for s in totals[k]:
            totals[k][s] = round(totals[k][s], 2)
    saldo_previsto = round(
        totals["receber"]["pendente"] + totals["receber"]["atrasado"]
        - totals["pagar"]["pendente"] - totals["pagar"]["atrasado"],
        2,
    )
    return {"month": month, **totals, "saldo_previsto": saldo_previsto}


@api_router.get("/financeiro/analise", dependencies=[Depends(require_admin)])
async def analise_financeira(date_from: str, date_to: str):
    """Consulta por período (ou o ano inteiro, passando 1º de janeiro a 31 de
    dezembro) para a tela de análise financeira: total e detalhamento por
    categoria de cada lado (pagar/receber), mais a série mensal para o
    gráfico de evolução. Base: valor total por due_date no período, mesmo
    critério do /resumo — não filtra por status pago/pendente."""
    docs = await db.financeiro.find(
        {"due_date": {"$gte": date_from, "$lte": date_to}}, {"_id": 0}
    ).to_list(10000)

    def by_category(kind: str) -> list:
        totals: dict = {}
        for d in docs:
            if d["kind"] != kind:
                continue
            totals[d["category"]] = totals.get(d["category"], 0.0) + d["amount"]
        return sorted(
            [{"category": c, "total": round(v, 2)} for c, v in totals.items()],
            key=lambda x: x["total"],
            reverse=True,
        )

    by_month: dict = {}
    for d in docs:
        key = d["due_date"][:7]
        b = by_month.setdefault(key, {"month": key, "pagar": 0.0, "receber": 0.0})
        b[d["kind"]] += d["amount"]
    months = sorted(by_month.values(), key=lambda x: x["month"])
    for m in months:
        m["pagar"] = round(m["pagar"], 2)
        m["receber"] = round(m["receber"], 2)

    receber_total = round(sum(d["amount"] for d in docs if d["kind"] == "receber"), 2)
    pagar_total = round(sum(d["amount"] for d in docs if d["kind"] == "pagar"), 2)
    return {
        "date_from": date_from,
        "date_to": date_to,
        "receber": {"total": receber_total, "by_category": by_category("receber")},
        "pagar": {"total": pagar_total, "by_category": by_category("pagar")},
        "saldo": round(receber_total - pagar_total, 2),
        "by_month": months,
    }


# ===================== Fornecedores =====================
class FornecedorInput(BaseModel):
    name: str
    category: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    document: Optional[str] = None  # CNPJ ou CPF
    observation: Optional[str] = None


class FornecedorUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    document: Optional[str] = None
    observation: Optional[str] = None


@api_router.post("/fornecedores", dependencies=[Depends(require_admin)])
async def create_fornecedor(payload: FornecedorInput):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Nome é obrigatório.")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "category": (payload.category or "").strip() or None,
        "phone": (payload.phone or "").strip() or None,
        "email": (payload.email or "").strip() or None,
        "document": (payload.document or "").strip() or None,
        "observation": (payload.observation or "").strip() or None,
        "active": True,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.fornecedores.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/fornecedores", dependencies=[Depends(require_admin)])
async def list_fornecedores(active: Optional[bool] = None):
    query: dict = {}
    if active is not None:
        query["active"] = active
    docs = await db.fornecedores.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return docs


@api_router.put("/fornecedores/{fid}", dependencies=[Depends(require_admin)])
async def update_fornecedor(fid: str, payload: FornecedorUpdate):
    updates = payload.dict(exclude_unset=True)
    if "name" in updates:
        if not (updates["name"] or "").strip():
            raise HTTPException(status_code=400, detail="Nome é obrigatório.")
        updates["name"] = updates["name"].strip()
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.fornecedores.update_one({"id": fid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    return await db.fornecedores.find_one({"id": fid}, {"_id": 0})


@api_router.patch("/fornecedores/{fid}/active", dependencies=[Depends(require_admin)])
async def set_fornecedor_active(fid: str, payload: ActiveInput):
    res = await db.fornecedores.update_one(
        {"id": fid},
        {"$set": {"active": payload.active, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    return await db.fornecedores.find_one({"id": fid}, {"_id": 0})


@api_router.delete("/fornecedores/{fid}", dependencies=[Depends(require_admin)])
async def delete_fornecedor(fid: str):
    res = await db.fornecedores.delete_one({"id": fid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    return {"ok": True}


# ===================== Conveniência: Lista de Compras =====================
class CompraItemInput(BaseModel):
    name: str
    quantity: Optional[str] = None
    observation: Optional[str] = None


class CompraItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[str] = None
    observation: Optional[str] = None


class DoneInput(BaseModel):
    done: bool


@api_router.post("/lista-compras", dependencies=[Depends(require_admin)])
async def create_compra_item(payload: CompraItemInput):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Nome é obrigatório.")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "quantity": (payload.quantity or "").strip() or None,
        "observation": (payload.observation or "").strip() or None,
        "done": False,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.lista_compras.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/lista-compras", dependencies=[Depends(require_admin)])
async def list_compras(done: Optional[bool] = None):
    query: dict = {} if done is None else {"done": done}
    return await db.lista_compras.find(query, {"_id": 0}).sort("created_at", 1).to_list(1000)


@api_router.put("/lista-compras/{cid}", dependencies=[Depends(require_admin)])
async def update_compra_item(cid: str, payload: CompraItemUpdate):
    updates = payload.dict(exclude_unset=True)
    if "name" in updates:
        if not (updates["name"] or "").strip():
            raise HTTPException(status_code=400, detail="Nome é obrigatório.")
        updates["name"] = updates["name"].strip()
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.lista_compras.update_one({"id": cid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item não encontrado.")
    return await db.lista_compras.find_one({"id": cid}, {"_id": 0})


@api_router.patch("/lista-compras/{cid}/done", dependencies=[Depends(require_admin)])
async def set_compra_done(cid: str, payload: DoneInput):
    res = await db.lista_compras.update_one(
        {"id": cid},
        {"$set": {"done": payload.done, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item não encontrado.")
    return await db.lista_compras.find_one({"id": cid}, {"_id": 0})


@api_router.delete("/lista-compras/{cid}", dependencies=[Depends(require_admin)])
async def delete_compra_item(cid: str):
    res = await db.lista_compras.delete_one({"id": cid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item não encontrado.")
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

# CORS_ORIGINS: comma-separated list of allowed origins (e.g. the deployed web
# app's URL). Falls back to "*" (any origin) if unset, matching prior behavior,
# but then allow_credentials must stay False — the "*" + credentials=True
# combination is rejected by browsers anyway and was never doing anything
# useful. Set CORS_ORIGINS explicitly in production to lock this down and get
# real credentialed-CORS if you ever need it.
_cors_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_origins_env:
    _cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
    _cors_credentials = True
else:
    _cors_origins = ["*"]
    _cors_credentials = False
    logger.warning(
        "CORS_ORIGINS não definido — liberando qualquer origem (allow_credentials=False). "
        "Defina CORS_ORIGINS em produção com o(s) domínio(s) real(is) do app."
    )

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_cors_credentials,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
