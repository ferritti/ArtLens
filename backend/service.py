import json
from typing import Any, Dict, List, Optional

import numpy as np

from .db import run


def l2_normalize(arr: List[float]) -> List[float]:
    v = np.asarray(arr, dtype=np.float64)  # store as float8[] in PG
    n = np.linalg.norm(v)
    return (v / n).tolist() if n > 0 else v.tolist()


def get_db_dim() -> Optional[int]:
    row = run("select value from settings where key='db_dim' limit 1").fetchone()
    if not row:
        return None
    try:
        return int((row[0] or {}).get('value'))
    except Exception:
        return None


def ensure_db_dim(dim: int):
    run(
        """
        insert into settings(key, value) values ('db_dim', jsonb_build_object('value', :dim))
        on conflict (key) do nothing
        """,
        {"dim": dim}
    )


def upsert_artwork_with_descriptors(data: Dict[str, Any]):
    art_id = str(data["id"]).strip()
    descs = data.get("visual_descriptors") or []

    normalized: List[Dict[str, Any]] = []
    observed_dim: Optional[int] = None
    for idx, vd in enumerate(descs):
        emb = vd.get("embedding")
        if isinstance(emb, list):
            norm = l2_normalize(emb)
            if observed_dim is None:
                observed_dim = len(norm)
            elif len(norm) != observed_dim:
                raise ValueError(f"Descriptor {idx} dim mismatch")
            normalized.append({
                "descriptor_id": vd.get("id") or f"main#{idx}",
                "image_path": vd.get("image_path"),
                "embedding": norm,
            })

    db_dim = get_db_dim()
    if observed_dim:
        if db_dim is None:
            ensure_db_dim(observed_dim)
        elif observed_dim != db_dim:
            raise ValueError(f"Embedding dim mismatch: got {observed_dim}, expected {db_dim}")

    # Upsert artwork metadata
    run(
        """
        insert into artworks (id, title, artist, year, museum, location, descriptions, updated_at)
        values (:id, :title, :artist, :year, :museum, :location, cast(:descriptions as jsonb), now())
        on conflict (id) do update set
          title=excluded.title,
          artist=excluded.artist,
          year=excluded.year,
          museum=excluded.museum,
          location=excluded.location,
          descriptions=excluded.descriptions,
          updated_at=now()
        """,
        {
            "id": art_id,
            "title": data.get("title"),
            "artist": data.get("artist"),
            "year": data.get("year"),
            "museum": data.get("museum"),
            "location": data.get("location"),
            "descriptions": json.dumps(data.get("descriptions") or {}),
        }
    )

    # Upsert descriptors
    for d in normalized:
        run(
            """
            insert into descriptors (artwork_id, descriptor_id, image_path, embedding)
            values (:art_id, :desc_id, :image_path, :embedding)
            on conflict (artwork_id, descriptor_id) do update set
              image_path = excluded.image_path,
              embedding = excluded.embedding
            """,
            {
                "art_id": art_id,
                "desc_id": d["descriptor_id"],
                "image_path": d.get("image_path"),
                "embedding": d["embedding"],
            }
        )
