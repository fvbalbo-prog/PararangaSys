from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
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
    # Optional fields — only for descida
    expected_return_date: Optional[str] = None
    expected_return_time: Optional[str] = None
    destination: Optional[str] = None
    passengers: Optional[int] = None
    responsible: Optional[str] = None
    observation: Optional[str] = None
    # Status: "agendada" | "cancelada" | "concluida"
    status: str = "agendada"
    returned_at: Optional[str] = None


class RequestCreate(RequestBase):
    pass


class RequestUpdate(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    expected_return_date: Optional[str] = None
    expected_return_time: Optional[str] = None
    destination: Optional[str] = None
    passengers: Optional[int] = None
    responsible: Optional[str] = None
    observation: Optional[str] = None


class RequestOut(RequestBase):
    id: str
    user_name: Optional[str] = None
    boat_name: Optional[str] = None
    created_at: str
    updated_at: str


# ===================== Validation =====================
def validate_request_payload(payload: RequestBase):
    t = parse_hhmm(payload.time)
    if not t:
        raise HTTPException(status_code=400, detail="Horário inválido. Use HH:MM.")

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
    user = await db.users.find_one({"cpf": payload.cpf}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="CPF não cadastrado.")

    now_iso = datetime.now(timezone.utc).isoformat()
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_name"] = user["name"]
    doc["boat_name"] = user["boat_name"]
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
    validate_request_payload(RequestBase(**{k: merged.get(k) for k in RequestBase.__fields__.keys()}))
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


@api_router.delete("/requests/{request_id}")
async def delete_request(request_id: str):
    res = await db.requests.delete_one({"id": request_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return {"ok": True}


# ===================== Seed =====================
SEED_USERS = [
    {"cpf": "11111111111", "name": "João Silva", "phone": "(48) 99999-1111", "boat_name": "Netuno", "is_admin": False},
    {"cpf": "22222222222", "name": "Maria Santos", "phone": "(48) 99999-2222", "boat_name": "Poseidon", "is_admin": False},
    {"cpf": "33333333333", "name": "Carlos Oliveira", "phone": "(48) 99999-3333", "boat_name": "Aurora", "is_admin": False},
    {"cpf": "00000000000", "name": "Administração Marina", "phone": "(48) 3000-0000", "boat_name": "Marina Pararanga", "is_admin": True},
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
