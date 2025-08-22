import os
import socket
from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url

# SQLAlchemy engine for Supabase Postgres
# Requires environment variable SUPABASE_DB_URL (include sslmode=require)
raw_url = os.environ["SUPABASE_DB_URL"]

# Ensure SQLAlchemy uses psycopg v3 driver (not psycopg2)
if raw_url.startswith("postgres://"):
    raw_url = "postgresql+psycopg://" + raw_url[len("postgres://"):]
elif raw_url.startswith("postgresql://") and not raw_url.startswith("postgresql+psycopg://"):
    raw_url = "postgresql+psycopg://" + raw_url[len("postgresql://"):]

# Force IPv4 by adding hostaddr=<A record> while retaining hostname for TLS/SNI
url = make_url(raw_url)
query = dict(url.query)
if url.host and "hostaddr" not in query:
    try:
        ipv4 = socket.getaddrinfo(url.host, None, family=socket.AF_INET)[0][4][0]
        query["hostaddr"] = ipv4
        url = url.set(query=query)
        # Optional: avoid printing secrets; log minimal info
        print("[ArtLens] Using IPv4 hostaddr for DB connection")
    except Exception as _e:
        # If resolution fails, continue without hostaddr
        pass

DB_URL = str(url)

# Keep pool small for free tiers
engine = create_engine(DB_URL, pool_size=5, max_overflow=5, pool_pre_ping=True)


def run(sql: str, params=None):
    """Execute a SQL statement within a transaction and return the result cursor."""
    with engine.begin() as conn:
        return conn.execute(text(sql), params or {})
