from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any, Tuple
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

# Supabase integration imports and admin token
from .db import run
from .service import upsert_artwork_with_descriptors
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")

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

# Serve static images (e.g., hotspot icon) from backend/images at /images
IMAGES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "images"))
if os.path.isdir(IMAGES_DIR):
    app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")

# ----------------------------------------------------------------------------
# In-memory DB
# ----------------------------------------------------------------------------
# Backward-compat synthesized items (single embedding per artwork)
items: List[Dict[str, Any]] = []
# Native v2 structures
artworks: Dict[str, Dict[str, Any]] = {}
flat_descriptors: List[Dict[str, Any]] = []
# Embedding dimension
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
    global items, artworks, flat_descriptors, db_dim
    items = []
    artworks = {}
    flat_descriptors = []
    db_dim = None
    if not os.path.exists(ART_DB_PATH):
        print(f"[ArtLens] DB file not found at {ART_DB_PATH}. Starting with empty DB.")
        return
    try:
        with open(ART_DB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        # v2 format: dict of artworks
        if isinstance(data, dict) and not isinstance(data.get("items"), list):
            for art_id, meta in data.items():
                if not isinstance(meta, dict):
                    continue
                item = {**meta}
                # normalize descriptions map
                if not isinstance(item.get("descriptions"), dict):
                    desc = item.get("description")
                    if isinstance(desc, str) and desc:
                        item["descriptions"] = {"it": desc}
                item.pop("description", None)

                # extract visual descriptors
                vd_list = []
                vds = item.get("visual_descriptors") or []
                for idx, vd in enumerate(vds):
                    if not isinstance(vd, dict):
                        continue
                    emb = vd.get("embedding")
                    if isinstance(emb, list):
                        v = np.asarray(emb, dtype=np.float32)
                        v = _l2_normalize(v)
                        if db_dim is None:
                            db_dim = int(v.shape[0])
                        elif int(v.shape[0]) != int(db_dim):
                            # skip wrong-dim descriptor
                            continue
                        desc_id = vd.get("id") or vd.get("image_path") or f"{art_id}#{idx}"
                        flat_descriptors.append({
                            "artwork_id": str(art_id),
                            "descriptor_id": str(desc_id),
                            "image_path": vd.get("image_path"),
                            "embedding": v.tolist(),
                        })
                        # store meta without embedding
                        vd_meta = {k: v for k, v in vd.items() if k != "embedding"}
                        vd_list.append(vd_meta)
                item["visual_descriptors"] = vd_list
                item["id"] = str(art_id)
                artworks[str(art_id)] = item

            # synthesize legacy items list (first descriptor per artwork)
            for art_id, art in artworks.items():
                first = next((d for d in flat_descriptors if d["artwork_id"] == art_id), None)
                desc_map = art.get("descriptions") if isinstance(art.get("descriptions"), dict) else {}
                # language fallback: it -> en -> first available
                description = desc_map.get("it") or desc_map.get("en") or (next(iter(desc_map.values())) if desc_map else None)
                it = {k: v for k, v in art.items() if k not in ("visual_descriptors", "descriptions")}
                it["id"] = art_id
                if description:
                    it["description"] = description
                if first:
                    it["embedding"] = first.get("embedding")
                items.append(it)
        else:
            # legacy format
            items = _ensure_list_of_items(data)
            for it in items:
                emb = it.get("embedding")
                if isinstance(emb, list):
                    v = np.asarray(emb, dtype=np.float32)
                    v = _l2_normalize(v)
                    it["embedding"] = v.tolist()
                    if db_dim is None:
                        db_dim = int(v.shape[0])

            # also build artworks/flat_descriptors from legacy for uniformity
            for it in items:
                art_id = str(it.get("id") or it.get("title") or len(artworks))
                meta = {k: v for k, v in it.items() if k not in ("embedding",)}
                meta["id"] = art_id
                artworks[art_id] = meta
                if isinstance(it.get("embedding"), list):
                    flat_descriptors.append({
                        "artwork_id": art_id,
                        "descriptor_id": art_id,
                        "image_path": None,
                        "embedding": it["embedding"],
                    })
    except Exception as e:
        print(f"[ArtLens] Failed to load DB: {e}")
        items = []
        artworks = {}
        flat_descriptors = []
        db_dim = None


def _truthy_env(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")

if _truthy_env("USE_JSON_DB", "false"):
    load_db()
else:
    # In production we rely on Supabase and skip loading legacy JSON DB
    print("[ArtLens] USE_JSON_DB is false: skipping legacy JSON load. Using Supabase cache.")

# ----------------------------------------------------------------------------
# Schemas
# ----------------------------------------------------------------------------
class VisualDescriptor(BaseModel):
    id: Optional[str] = None
    image_path: Optional[str] = None

class CatalogItem(BaseModel):
    id: str
    title: Optional[str] = None
    artist: Optional[str] = None
    year: Optional[str] = None
    museum: Optional[str] = None
    location: Optional[str] = None
    descriptions: Optional[Dict[str, str]] = None
    visual_descriptors: Optional[List[VisualDescriptor]] = None
    model_config = ConfigDict(extra='allow')

class MatchRequest(BaseModel):
    embedding: List[float] = Field(..., description="Normalized embedding vector")
    top_k: int = Field(1, ge=1, le=50)
    threshold: float = Field(0.0, ge=-1.0, le=1.0)
    lang: Optional[str] = Field(default=None, description='Preferred language for description (it, en, ...)')

class MatchItem(BaseModel):
    artwork_id: str
    descriptor_id: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    description: Optional[str] = None
    confidence: float
    image_path: Optional[str] = None

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
    return {
        "status": "ok",
        "count": len(flat_descriptors),
        "dim": db_dim,
        "backend_db": "supabase",
    }


@app.get("/items", response_model=List[Item])
def list_items():
    # Legacy endpoint: only available when USE_JSON_DB=true
    if not _truthy_env("USE_JSON_DB", "false"):
        raise HTTPException(status_code=410, detail="/items is disabled (USE_JSON_DB=false)")
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
    rows = run(
        """
        select id, title, artist, year, museum, location, descriptions
        from artworks
        order by title nulls last
        """
    ).mappings().all()
    return [dict(r) for r in rows]


@app.get("/descriptors", response_model=Dict[str, List[float]])
def get_descriptors():
    rows = run(
        """
        select distinct on (artwork_id) artwork_id, embedding
        from descriptors
        order by artwork_id, descriptor_id
        """
    ).all()
    out: Dict[str, List[float]] = {}
    for art_id, emb in rows:
        out[str(art_id)] = list(emb)
    return out

# New v2 endpoints
@app.get("/descriptors_v2", response_model=Dict[str, List[List[float]]])
def get_descriptors_v2():
    rows = run("select artwork_id, embedding from descriptors").all()
    out: Dict[str, List[List[float]]] = {}
    for art_id, emb in rows:
        out.setdefault(str(art_id), []).append(list(emb))
    return out

@app.get("/descriptors_meta_v2")
def get_descriptors_meta_v2():
    return [
        {
            "artwork_id": d["artwork_id"],
            "descriptor_id": d.get("descriptor_id"),
            "image_path": d.get("image_path"),
            "embedding": d.get("embedding"),
        }
        for d in flat_descriptors
    ]


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
    if not flat_descriptors:
        raise HTTPException(status_code=503, detail="Empty database")
    q = np.asarray(req.embedding, dtype=np.float32)
    if q.ndim != 1:
        q = q.reshape(-1)
    if db_dim is None:
        # infer from first descriptor
        for d in flat_descriptors:
            if isinstance(d.get("embedding"), list):
                db_dim = len(d["embedding"])
                break
    if db_dim is None:
        raise HTTPException(status_code=503, detail="Database embeddings dimension unknown")
    if int(q.shape[0]) != int(db_dim):
        raise HTTPException(status_code=400, detail=f"Embedding dim mismatch: got {q.shape[0]}, expected {db_dim}")
    q = _l2_normalize(q)

    # score per descriptor, keep best per artwork
    best_per_artwork: Dict[str, Dict[str, Any]] = {}
    for d in flat_descriptors:
        v = np.asarray(d["embedding"], dtype=np.float32)
        s = float(np.dot(q, v))
        if s < req.threshold:
            continue
        art_id = d["artwork_id"]
        cur = best_per_artwork.get(art_id)
        if cur is None or s > cur["score"]:
            best_per_artwork[art_id] = {"score": s, "descriptor": d}

    ranked = sorted(best_per_artwork.items(), key=lambda x: x[1]["score"], reverse=True)[: req.top_k]

    lang = (req.lang or '').lower()[:2] if req.lang else None
    results: List[MatchItem] = []
    for art_id, info in ranked:
        art = artworks.get(art_id, {})
        desc_text = None
        desc_map = art.get("descriptions") if isinstance(art.get("descriptions"), dict) else None
        if desc_map:
            if lang and desc_map.get(lang):
                desc_text = desc_map.get(lang)
            else:
                desc_text = desc_map.get('it') or desc_map.get('en') or next(iter(desc_map.values()), None)
        d = info["descriptor"]
        results.append(MatchItem(
            artwork_id=art_id,
            descriptor_id=d.get("descriptor_id"),
            title=art.get("title"),
            artist=art.get("artist"),
            description=desc_text,
            confidence=float(info["score"]),
            image_path=d.get("image_path"),
        ))

    return MatchResponse(matches=results)


# ----------------------------------------------------------------------------
# How to run (local dev):
#   pip install -r backend/requirements.txt
#   uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
# Optionally set:
#   export ART_DB_PATH=backend/data/artwork_database.json
#   export FRONTEND_ORIGINS=http://localhost:5173
# ----------------------------------------------------------------------------



# -----------------------------
# Supabase admin + health DB
# -----------------------------
class ArtworkUpsert(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    year: Optional[str] = None
    museum: Optional[str] = None
    location: Optional[str] = None
    descriptions: Optional[Dict[str, str]] = None
    visual_descriptors: Optional[List[Dict[str, Any]]] = None
    model_config = ConfigDict(extra='allow')


import re, unicodedata

def _slugify(text: str) -> str:
    if not text:
        return "opera"
    s = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = s.strip('-')
    return s or "opera"


def _ensure_unique_art_id(base_id: str) -> str:
    candidate = base_id or "opera"
    suffix = 2
    while True:
        row = run("select 1 from artworks where id = :id limit 1", {"id": candidate}).fetchone()
        if not row:
            return candidate
        candidate = f"{base_id}-{suffix}" if base_id else f"opera-{suffix}"
        suffix += 1


@app.post("/artworks")
def upsert_artwork(art: ArtworkUpsert, x_admin_token: str = Header(default="")):
    if not ADMIN_TOKEN or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        art_dict = art.model_dump()
        art_id = (art_dict.get("id") or "").strip() if isinstance(art_dict.get("id"), str) else None
        if not art_id:
            base = _slugify(art_dict.get("title") or "")
            art_id = _ensure_unique_art_id(base)
            art_dict["id"] = art_id

        upsert_artwork_with_descriptors(art_dict)
        # Refresh in-memory cache from Supabase so /match reflects the latest data
        try:
            _refresh_cache_from_db()
        except Exception as re:
            # Log but do not fail the upsert response
            print("[ArtLens] cache refresh error after upsert:", re)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print("[ArtLens] upsert error:", e)
        raise HTTPException(status_code=500, detail="Failed to persist")
    return {"status": "ok", "id": art_id}


@app.get("/health_db")
def health_db():
    try:
        row = run("select count(*) from artworks").fetchone()
        cnt = int(row[0]) if row else 0
        return {"db": "supabase", "artworks": cnt}
    except Exception as e:
        return {"db": "supabase", "error": str(e)}


# -----------------------------
# Cache refresh from Supabase for /match
# -----------------------------
from typing import Tuple as _TupleAlias  # local alias to avoid shadowing

def _refresh_cache_from_db() -> _TupleAlias[int, int]:
    """Reload artworks and flat_descriptors from Supabase.
    Returns (num_artworks, num_descriptors).
    """
    global artworks, flat_descriptors, db_dim

    # Load artworks metadata
    rows_art = run(
        """
        select id, title, artist, year, museum, location, descriptions
        from artworks
        """
    ).mappings().all()
    new_artworks = {str(r["id"]): dict(r) for r in rows_art}

    # Load descriptors
    rows_desc = run(
        "select artwork_id, descriptor_id, image_path, embedding from descriptors order by artwork_id, descriptor_id"
    ).all()

    new_flat = []
    dim = None
    for art_id, desc_id, img, emb in rows_desc:
        # emb is a PG float8[] mapped as Python list/tuple via psycopg/SQLAlchemy
        vec = list(emb) if emb is not None else None
        if not isinstance(vec, list):
            continue
        if dim is None:
            dim = len(vec)
        elif len(vec) != dim:
            # Skip inconsistent dimensions
            continue
        new_flat.append({
            "artwork_id": str(art_id),
            "descriptor_id": str(desc_id),
            "image_path": img,
            "embedding": vec,
        })

    artworks = new_artworks
    flat_descriptors = new_flat
    db_dim = dim
    return (len(artworks), len(flat_descriptors))


# Refresh cache on startup so /match is ready without legacy JSON
@app.on_event("startup")
def _startup_refresh_cache():
    try:
        a, d = _refresh_cache_from_db()
        print(f"[ArtLens] Cache loaded from Supabase: artworks={a}, descriptors={d}, dim={db_dim}")
    except Exception as e:
        print(f"[ArtLens] Failed to load cache from Supabase at startup: {e}")
