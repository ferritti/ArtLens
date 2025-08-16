from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import os
import json
import numpy as np

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
# Path to JSON database (relative to project root by default)
ART_DB_PATH = os.getenv("ART_DB_PATH", os.path.join(os.path.dirname(__file__), "data", "artwork_database.json"))
ART_DB_PATH = os.path.abspath(ART_DB_PATH)

# Allow CORS origins (comma-separated). Default to local dev origins.
DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
FRONTEND_ORIGINS = [o.strip() for o in os.getenv("FRONTEND_ORIGINS", ",".join(DEFAULT_ORIGINS)).split(",") if o.strip()]

# ----------------------------------------------------------------------------
# App
# ----------------------------------------------------------------------------
app = FastAPI(title="ArtLens Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------------
# In-memory DB
# ----------------------------------------------------------------------------
items: List[Dict[str, Any]] = []
db_dim: Optional[int] = None


def _l2_normalize(vec: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(vec)
    return vec / n if n > 0 else vec


def _ensure_list_of_items(data) -> List[Dict[str, Any]]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if "items" in data and isinstance(data["items"], list):
            return data["items"]
        # Convert {id: {..}} to list
        return [{"id": k, **v} for k, v in data.items() if isinstance(v, dict)]
    return []


def load_db() -> None:
    global items, db_dim
    items = []
    db_dim = None
    if not os.path.exists(ART_DB_PATH):
        print(f"[ArtLens] DB file not found at {ART_DB_PATH}. Starting with empty DB.")
        return
    try:
        with open(ART_DB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        items = _ensure_list_of_items(data)
        # Normalize and infer dimension
        for it in items:
            emb = it.get("embedding")
            if isinstance(emb, list):
                v = np.asarray(emb, dtype=np.float32)
                v = _l2_normalize(v)
                it["embedding"] = v.tolist()
                if db_dim is None:
                    db_dim = int(v.shape[0])
    except Exception as e:
        print(f"[ArtLens] Failed to load DB: {e}")
        items = []
        db_dim = None


load_db()

# ----------------------------------------------------------------------------
# Schemas
# ----------------------------------------------------------------------------
class MatchRequest(BaseModel):
    embedding: List[float] = Field(..., description="Normalized embedding vector")
    top_k: int = Field(1, ge=1, le=50)
    threshold: float = Field(0.0, ge=-1.0, le=1.0)


class MatchItem(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    year: Optional[str] = None
    museum: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    confidence: float


class MatchResponse(BaseModel):
    matches: List[MatchItem]


class Item(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    year: Optional[str] = None
    museum: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    embedding: Optional[List[float]] = None


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "count": len(items), "dim": db_dim, "db_path": ART_DB_PATH}


@app.get("/items", response_model=List[Item])
def list_items():
    # Backward-compat: return full items (including embeddings)
    return items


# Option B: separate catalog (metadata) and descriptors (embeddings)
class CatalogItem(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    year: Optional[str] = None
    museum: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None

    # Pydantic v2: allow unknown/extra fields to pass through (e.g., image, tags)
    model_config = ConfigDict(extra='allow')


@app.get("/catalog", response_model=List[CatalogItem])
def get_catalog():
    catalog: List[Dict[str, Any]] = []
    for it in items:
        # Copy without embedding
        data = {k: v for k, v in it.items() if k != "embedding"}
        # Ensure id present
        if data.get("id") is None:
            key = data.get("title")
            if key is not None:
                data["id"] = str(key)
        catalog.append(data)
    return catalog


@app.get("/descriptors", response_model=Dict[str, List[float]])
def get_descriptors():
    desc: Dict[str, List[float]] = {}
    for it in items:
        emb = it.get("embedding")
        if isinstance(emb, list):
            _id = it.get("id") or it.get("title")
            if _id is not None:
                desc[str(_id)] = emb
    return desc


@app.post("/items", response_model=Item)
def upsert_item(item: Item):
    global db_dim
    data = item.dict()
    if data.get("embedding") is not None:
        vec = np.asarray(data["embedding"], dtype=np.float32)
        vec = _l2_normalize(vec)
        data["embedding"] = vec.tolist()
        if db_dim is None:
            db_dim = int(vec.shape[0])
        elif int(vec.shape[0]) != int(db_dim):
            raise HTTPException(status_code=400, detail=f"Embedding dim mismatch: got {vec.shape[0]}, expected {db_dim}")

    # Upsert by id or title
    key = data.get("id") or data.get("title")
    if key is None:
        raise HTTPException(status_code=400, detail="Item must have at least 'id' or 'title'")

    # Ensure id string
    if data.get("id") is None:
        data["id"] = str(key)

    for i, it in enumerate(items):
        if str(it.get("id")) == str(data["id"]):
            items[i] = {**it, **data}
            return items[i]
    items.append(data)
    return data


@app.post("/match", response_model=MatchResponse)
def match(req: MatchRequest):
    global db_dim
    if not items:
        raise HTTPException(status_code=503, detail="Empty database")
    q = np.asarray(req.embedding, dtype=np.float32)
    if q.ndim != 1:
        q = q.reshape(-1)
    if db_dim is None:
        # infer from first item with embedding
        for it in items:
            if isinstance(it.get("embedding"), list):
                db_dim = len(it["embedding"])
                break
    if db_dim is None:
        raise HTTPException(status_code=503, detail="Database embeddings dimension unknown")
    if int(q.shape[0]) != int(db_dim):
        raise HTTPException(status_code=400, detail=f"Embedding dim mismatch: got {q.shape[0]}, expected {db_dim}")
    q = _l2_normalize(q)

    scores = []
    for it in items:
        emb = it.get("embedding")
        if not isinstance(emb, list):
            continue
        v = np.asarray(emb, dtype=np.float32)
        s = float(np.dot(q, v))  # cosine similarity (normalized)
        if s >= req.threshold:
            scores.append((s, it))

    scores.sort(key=lambda x: x[0], reverse=True)
    top = scores[: req.top_k]
    matches = [
        MatchItem(
            id=str(it.get("id")) if it.get("id") is not None else None,
            title=it.get("title"),
            artist=it.get("artist"),
            year=it.get("year"),
            museum=it.get("museum"),
            location=it.get("location"),
            description=it.get("description"),
            confidence=float(s),
        )
        for s, it in top
    ]
    return MatchResponse(matches=matches)


# ----------------------------------------------------------------------------
# How to run (local dev):
#   pip install -r backend/requirements.txt
#   uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
# Optionally set:
#   export ART_DB_PATH=backend/data/artwork_database.json
#   export FRONTEND_ORIGINS=http://localhost:5173
# ----------------------------------------------------------------------------
