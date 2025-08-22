import os
from sqlalchemy import create_engine, text

# SQLAlchemy engine for Supabase Postgres
# Requires environment variable SUPABASE_DB_URL (include sslmode=require)
DB_URL = os.environ["SUPABASE_DB_URL"]

# Keep pool small for free tiers
engine = create_engine(DB_URL, pool_size=5, max_overflow=5, pool_pre_ping=True)


def run(sql: str, params=None):
    """Execute a SQL statement within a transaction and return the result cursor."""
    with engine.begin() as conn:
        return conn.execute(text(sql), params or {})
