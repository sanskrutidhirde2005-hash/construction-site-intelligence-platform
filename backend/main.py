"""FastAPI + SQLite backend for construction platform."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import tempfile
import time
import urllib.request

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except Exception:
    pass

app = FastAPI(title="Construction Platform API")

DB_PATH = os.path.join(os.path.dirname(__file__), "construction.db")
STATIC_ROOT = os.path.join(os.path.dirname(__file__), "static")
FRAMES_ROOT = os.path.join(STATIC_ROOT, "frames")
os.makedirs(FRAMES_ROOT, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_ROOT), name="static")

OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")

AUTH_SECRET = os.getenv("AUTH_SECRET", "dev-buildsafe-secret-change-me")
AUTH_TOKEN_TTL_SEC = 7 * 24 * 3600
ALLOWED_ROLES = {
    "Project Manager",
    "Site Supervisor",
    "Contractor",
    "Safety Officer",
    "Client / Owner",
    "Admin",
}


# Pydantic models
class Project(BaseModel):
    id: int | None = None
    name: str
    description: str | None = None
    status: str | None = "Active"
    total_budget: float | None = 0
    progress: int | None = 0
    created_at: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    total_budget: float | None = None
    progress: int | None = None


class Material(BaseModel):
    id: int | None = None
    project_id: int | None = None
    name: str
    category: str | None = None
    cost: float | None = None
    required_qty: float | None = 0
    received_qty: float | None = 0
    used_qty: float | None = 0
    unit: str | None = "units"


class Inspection(BaseModel):
    id: int | None = None
    project_id: int
    status: str
    notes: str | None = None


class GenAIRequest(BaseModel):
    query_text: str
    project_id: int | None = None


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str | None = "Project Manager"


class LoginRequest(BaseModel):
    email: str
    password: str


class AssignmentRequest(BaseModel):
    user_ids: list[int]


# Database helper
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'Active',
            total_budget REAL DEFAULT 0,
            progress INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            name TEXT NOT NULL,
            category TEXT,
            cost REAL,
            required_qty REAL DEFAULT 0,
            received_qty REAL DEFAULT 0,
            used_qty REAL DEFAULT 0,
            unit TEXT DEFAULT 'units'
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS inspections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            status TEXT NOT NULL,
            notes TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            area TEXT DEFAULT 'Site',
            kind TEXT DEFAULT 'video',
            title TEXT NOT NULL,
            details TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS genai_queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_text TEXT NOT NULL,
            project_id INTEGER,
            response_text TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Safety register (Daily Updates reads these; empty tables return []).
    # Column layout mirrors backend/database.py SQLAlchemy models so a
    # future ORM migration converges instead of diverging.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS safety_issues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            severity TEXT DEFAULT 'Medium',
            reported_at TEXT DEFAULT CURRENT_TIMESTAMP,
            resolved_at TEXT,
            reported_by TEXT,
            source TEXT DEFAULT 'manual',
            status TEXT DEFAULT 'confirmed',
            observation_id INTEGER,
            confidence REAL,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS risks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            severity TEXT DEFAULT 'Medium',
            detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
            mitigation_plan TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ppe_violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            category TEXT,
            severity TEXT DEFAULT 'High',
            detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
            resolved_at TEXT,
            image_path TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'Project Manager',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ---------------- Phase 2: location hierarchy + evidence/alert registers ---
    # Reuse-first: projects/users/materials(Inventory)/inspections(Daily
    # Updates)/safety_issues(Incidents)/observations/risks stay canonical.
    # Budget stays derived (projects.total_budget + SUM(cost*used_qty)) — no
    # duplicate table. Only genuinely missing entities are created here:
    # sites > buildings > floors > areas, a queryable site_images register
    # (observations hold analysis verdicts; images hold evidence files +
    # provenance), and a unified alerts queue fed by risk/safety/inspection/
    # budget/vision sources.
    _phase2_tables(cursor)

    # Indexes for the hot query paths (list-by-project, dashboard counts,
    # Daily Updates per-project-per-date). IF NOT EXISTS => safe on restart.
    for stmt in _phase2_indexes():
        cursor.execute(stmt)

    conn.commit()
    conn.close()


def _phase2_tables(cursor):
    """CREATE the Phase-2 tables. Idempotent; shared by init_db (fresh DB)
    and _migrate (pre-existing DB) so both converge on one schema."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            location TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS buildings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS floors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            building_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            level INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (building_id) REFERENCES buildings(id)
        )
    """)

    # areas.site_id is mandatory; building/floor links are nullable so a
    # flat site (no buildings modelled yet) can still register areas, and
    # free-text observations/inspections keep working during adoption.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id INTEGER NOT NULL,
            building_id INTEGER,
            floor_id INTEGER,
            name TEXT NOT NULL,
            kind TEXT DEFAULT 'area',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (site_id) REFERENCES sites(id),
            FOREIGN KEY (building_id) REFERENCES buildings(id),
            FOREIGN KEY (floor_id) REFERENCES floors(id)
        )
    """)

    # Evidence register: one row per uploaded site photo with queryable
    # provenance. The analysis verdict stays on observations (kind='photo',
    # linked via observation_id); the file + EXIF/device evidence lives here.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS site_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            site_id INTEGER,
            observation_id INTEGER,
            file_path TEXT,
            original_url TEXT,
            annotated_url TEXT,
            taken_at TEXT,
            lat REAL,
            lon REAL,
            provenance_source TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (site_id) REFERENCES sites(id),
            FOREIGN KEY (observation_id) REFERENCES observations(id)
        )
    """)

    # Unified alert queue: risks / safety_issues(incidents) / inspections /
    # budget forecasts / vision flags all surface here instead of a new
    # per-source table each. source_id points at the originating row.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            site_id INTEGER,
            source TEXT NOT NULL,
            source_id INTEGER,
            severity TEXT DEFAULT 'Medium',
            title TEXT NOT NULL,
            status TEXT DEFAULT 'open',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            resolved_at TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (site_id) REFERENCES sites(id)
        )
    """)

    # Phase 12: weekly report snapshots. Each generation stores its numbers
    # so the NEXT report can show honest deltas (progress then vs now)
    # instead of inventing a baseline.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS weekly_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            week_start TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            payload TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)

    # Phase 13: project assignments. Admins attach pre-registered users
    # (typically Project Managers) to projects; the Projects list is then
    # scoped per account. Junction, not a duplicate project/user model.
    # Unassigned projects stay visible to every signed-in account so the
    # existing demo keeps working until an admin assigns them.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)


def _phase2_indexes():
    return [
        "CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)",
        "CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_materials_project_name "
        "ON materials(project_id, name)",
        "CREATE INDEX IF NOT EXISTS idx_inspections_project "
        "ON inspections(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_inspections_project_date "
        "ON inspections(project_id, log_date)",
        "CREATE INDEX IF NOT EXISTS idx_observations_project "
        "ON observations(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_safety_project "
        "ON safety_issues(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_risks_project ON risks(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_ppe_project "
        "ON ppe_violations(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_genai_project "
        "ON genai_queries(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_sites_project ON sites(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_buildings_site ON buildings(site_id)",
        "CREATE INDEX IF NOT EXISTS idx_floors_building ON floors(building_id)",
        "CREATE INDEX IF NOT EXISTS idx_areas_site ON areas(site_id)",
        "CREATE INDEX IF NOT EXISTS idx_site_images_project "
        "ON site_images(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_site_images_observation "
        "ON site_images(observation_id)",
        "CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)",
        "CREATE INDEX IF NOT EXISTS idx_weekly_project ON weekly_reports(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id)",
    ]


def _migrate():
    """Add new columns to pre-existing databases (idempotent)."""
    conn = get_db()
    cursor = conn.cursor()
    existing = {r[1] for r in cursor.execute("PRAGMA table_info(projects)").fetchall()}
    if "status" not in existing:
        cursor.execute("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'Active'")
        cursor.execute("UPDATE projects SET status = 'Active' WHERE status IS NULL")
    if "total_budget" not in existing:
        cursor.execute("ALTER TABLE projects ADD COLUMN total_budget REAL DEFAULT 0")
        cursor.execute("UPDATE projects SET total_budget = 0 WHERE total_budget IS NULL")
    if "progress" not in existing:
        cursor.execute("ALTER TABLE projects ADD COLUMN progress INTEGER DEFAULT 0")
        cursor.execute("UPDATE projects SET progress = 0 WHERE progress IS NULL")
    mexisting = {r[1] for r in cursor.execute("PRAGMA table_info(materials)").fetchall()}
    for col, ddl in [
        ("project_id", "INTEGER"),
        ("required_qty", "REAL DEFAULT 0"),
        ("received_qty", "REAL DEFAULT 0"),
        ("used_qty", "REAL DEFAULT 0"),
        ("unit", "TEXT DEFAULT 'units'"),
    ]:
        if col not in mexisting:
            cursor.execute(f"ALTER TABLE materials ADD COLUMN {col} {ddl}")
    # Voice daily updates reuse the inspections model (no duplicate tables):
    # manual rows keep NULL/‘manual’ here, voice rows carry transcript + JSON.
    iexisting = {r[1] for r in cursor.execute("PRAGMA table_info(inspections)").fetchall()}
    for col, ddl in [
        ("source", "TEXT DEFAULT 'manual'"),
        ("transcript", "TEXT"),
        ("structured", "TEXT"),
        ("area", "TEXT"),
        ("log_date", "TEXT"),
        # Phase 2: structured location links. Free-text `area` keeps working;
        # building/floor graduate from notes/JSON into queryable columns.
        ("site_id", "INTEGER"),
        ("building", "TEXT"),
        ("floor", "TEXT"),
    ]:
        if col not in iexisting:
            cursor.execute(f"ALTER TABLE inspections ADD COLUMN {col} {ddl}")
    # Phase 2: location links on the reused registers (all nullable so
    # existing rows stay valid). No new duplicate entities.
    oexisting = {r[1] for r in cursor.execute("PRAGMA table_info(observations)").fetchall()}
    if "site_id" not in oexisting:
        cursor.execute("ALTER TABLE observations ADD COLUMN site_id INTEGER")
    sexisting = {r[1] for r in cursor.execute("PRAGMA table_info(safety_issues)").fetchall()}
    for col, ddl in [("site_id", "INTEGER"), ("area_id", "INTEGER"),
                     # Phase 10: pending-AI-incident workflow. Human rows are
                     # 'confirmed'; vision rows start 'pending' until a
                     # supervisor confirms or dismisses them.
                     ("source", "TEXT DEFAULT 'manual'"),
                     ("status", "TEXT DEFAULT 'confirmed'"),
                     ("observation_id", "INTEGER"),
                     ("confidence", "REAL")]:
        if col not in sexisting:
            cursor.execute(f"ALTER TABLE safety_issues ADD COLUMN {col} {ddl}")
    cursor.execute("UPDATE safety_issues SET status = 'confirmed' "
                   "WHERE status IS NULL")
    cursor.execute("UPDATE safety_issues SET source = 'manual' "
                   "WHERE source IS NULL")
    rexisting = {r[1] for r in cursor.execute("PRAGMA table_info(risks)").fetchall()}
    for col, ddl in [
        ("site_id", "INTEGER"),
        ("status", "TEXT DEFAULT 'open'"),
        ("resolved_at", "TEXT"),
    ]:
        if col not in rexisting:
            cursor.execute(f"ALTER TABLE risks ADD COLUMN {col} {ddl}")
    matexisting = {r[1] for r in cursor.execute("PRAGMA table_info(materials)").fetchall()}
    if "site_id" not in matexisting:
        cursor.execute("ALTER TABLE materials ADD COLUMN site_id INTEGER")
    # Phase 2 tables + indexes on pre-existing databases (fresh DBs get them
    # via init_db; this converges old DBs to the same schema).
    _phase2_tables(cursor)
    for stmt in _phase2_indexes():
        cursor.execute(stmt)
    conn.commit()
    conn.close()


init_db()
_migrate()


# ---------------- Auth (email + password, stdlib only) ----------------
# PBKDF2 password hashing + HMAC-signed tokens. No extra dependencies,
# no OAuth. Tokens expire after 7 days; frontend stores the token and
# sends it as `Authorization: Bearer <token>`.

def _hash_password(password: str, salt_hex: str | None = None):
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return dk.hex(), salt.hex()


def _verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        dk, _ = _hash_password(password, salt_hex)
        return hmac.compare_digest(dk, hash_hex)
    except Exception:
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _make_token(user_id: int) -> str:
    payload = json.dumps(
        {"uid": user_id, "exp": int(time.time()) + AUTH_TOKEN_TTL_SEC},
        separators=(",", ":"),
    ).encode("utf-8")
    body = _b64url_encode(payload)
    sig = hmac.new(AUTH_SECRET.encode("utf-8"), body.encode("ascii"),
                   hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _verify_token(token: str) -> int | None:
    try:
        body, sig = token.split(".", 1)
        expected = hmac.new(AUTH_SECRET.encode("utf-8"), body.encode("ascii"),
                            hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return int(payload["uid"])
    except Exception:
        return None


def _public_user(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "created_at": row["created_at"] if "created_at" in row.keys() else None,
    }


def _get_user_by_id(user_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def _user_from_auth(authorization: str | None):
    """Signed-in user row, or None when no/invalid token. Reuses the
    existing HMAC token scheme — no new auth mechanism."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    user_id = _verify_token(authorization.split(" ", 1)[1].strip())
    if user_id is None:
        return None
    return _get_user_by_id(user_id)


def _require_admin(authorization: str | None):
    """Returns the admin user row. 401 without login, 403 without role."""
    user = _user_from_auth(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if user["role"] != "Admin":
        raise HTTPException(status_code=403,
                            detail="Admin access required.")
    return user


@app.post("/api/auth/register")
def register(req: RegisterRequest):
    name = (req.name or "").strip()
    email = (req.email or "").strip().lower()
    role = (req.role or "Project Manager").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if not req.password or len(req.password) < 6:
        raise HTTPException(status_code=400,
                            detail="Password must be at least 6 characters.")
    if role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="Unknown role.")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=409,
                            detail="An account with this email already exists.")
    pwd_hash, salt = _hash_password(req.password)
    cursor.execute(
        "INSERT INTO users (name, email, password_hash, password_salt, role) "
        "VALUES (?, ?, ?, ?, ?)",
        (name, email, pwd_hash, salt, role),
    )
    conn.commit()
    user_id = cursor.lastrowid
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return {"user": _public_user(row), "token": _make_token(user_id)}


@app.post("/api/auth/login")
def login(req: LoginRequest):
    email = (req.email or "").strip().lower()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    row = cursor.fetchone()
    conn.close()
    if row is None or not _verify_password(req.password or "",
                                           row["password_salt"],
                                           row["password_hash"]):
        raise HTTPException(status_code=401,
                            detail="Invalid email or password.")
    return {"user": _public_user(row), "token": _make_token(row["id"])}


@app.get("/api/auth/me")
def auth_me(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    user_id = _verify_token(authorization.split(" ", 1)[1].strip())
    if user_id is None:
        raise HTTPException(status_code=401,
                            detail="Session expired. Please sign in again.")
    row = _get_user_by_id(user_id)
    if row is None:
        raise HTTPException(status_code=401, detail="Account no longer exists.")
    return {"user": _public_user(row)}


# ---------------- Budget prediction (mirrors src/budget.js calcBudget) ----------------
# actual_spent = SUM(materials.cost * materials.used_qty) WHERE project_id = ?
# remaining = total_budget - actual_spent
# if progress > 0 and total_budget > 0:
#     predicted = actual_spent / (progress/100)
#     overrun = predicted - total_budget; overrun_pct = overrun/total_budget*100
# risk: overrun_pct > 10 -> HIGH, > 0 -> MEDIUM, else LOW.
# total_budget <= 0 or progress <= 0 -> predicted/overrun/overrun_pct None, risk UNKNOWN.
# All money in INR (₹).

def _calc_budget(total_budget, actual_spent, progress):
    """Mirror of frontend calcBudget() in src/budget.js. Pure function."""
    try:
        budget = float(total_budget or 0)
    except (TypeError, ValueError):
        budget = 0.0
    try:
        spent = float(actual_spent or 0)
    except (TypeError, ValueError):
        spent = 0.0
    try:
        prog = float(progress or 0)
    except (TypeError, ValueError):
        prog = 0.0
    remaining = budget - spent
    if budget <= 0:
        return {
            "total_budget": budget,
            "actual_spent": spent,
            "progress": prog,
            "remaining": remaining,
            "predicted": None,
            "overrun": None,
            "overrun_pct": None,
            "risk": "UNKNOWN",
            "note": "No budget set for this project yet.",
        }
    if prog <= 0:
        return {
            "total_budget": budget,
            "actual_spent": spent,
            "progress": prog,
            "remaining": remaining,
            "predicted": None,
            "overrun": None,
            "overrun_pct": None,
            "risk": "UNKNOWN",
            "note": "Not enough progress to forecast yet.",
        }
    # No consumption recorded yet: EAC would be 0/spent-divided, i.e. ₹0
    # predicted + LOW risk at 82% progress — mathematically valid but
    # operationally impossible. Unknown stays unknown (rule 12): forecast
    # only once used_qty rows exist. No invented spend.
    if spent <= 0:
        return {
            "total_budget": budget,
            "actual_spent": spent,
            "progress": prog,
            "remaining": remaining,
            "predicted": None,
            "overrun": None,
            "overrun_pct": None,
            "risk": "UNKNOWN",
            "note": "No material consumption recorded yet — add used quantities to forecast.",
        }
    predicted = spent / (prog / 100)
    overrun = predicted - budget
    overrun_pct = (overrun / budget) * 100
    risk = "HIGH" if overrun_pct > 10 else ("MEDIUM" if overrun_pct > 0 else "LOW")
    return {
        "total_budget": budget,
        "actual_spent": spent,
        "progress": prog,
        "remaining": remaining,
        "predicted": predicted,
        "overrun": overrun,
        "overrun_pct": overrun_pct,
        "risk": risk,
        "note": None,
    }


def _actual_spent(cursor, project_id):
    row = cursor.execute(
        "SELECT COALESCE(SUM(cost * used_qty), 0) FROM materials WHERE project_id = ?",
        (project_id,),
    ).fetchone()
    return float(row[0] or 0)


def _col(row, name, default=0):
    try:
        if name in row.keys():
            v = row[name]
            return default if v is None else v
    except Exception:
        pass
    return default


def _inr(value):
    if value is None:
        return "—"
    try:
        return f"₹{float(value):,.0f}"
    except (TypeError, ValueError):
        return "—"


# Project endpoints
@app.get("/api/projects")
def list_projects(authorization: str | None = Header(default=None)):
    """Scoped visibility. No token (scripts/tests/offline callers) → all,
    preserving existing behavior. Admin → all (plus assigned_user_ids per
    project for the assignment UI). Any other signed-in account → projects
    assigned to them plus unassigned (open) projects."""
    conn = get_db()
    cursor = conn.cursor()
    user = _user_from_auth(authorization)
    if user is None or user["role"] == "Admin":
        cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
        rows = cursor.fetchall()
        out = [dict(r) for r in rows]
        if user is not None:
            assn = cursor.execute(
                "SELECT project_id, user_id FROM project_members").fetchall()
            by_project: dict = {}
            for a in assn:
                by_project.setdefault(a["project_id"], []).append(a["user_id"])
            for p in out:
                p["assigned_user_ids"] = by_project.get(p["id"], [])
        conn.close()
        return out
    cursor.execute(
        "SELECT * FROM projects WHERE id IN "
        "(SELECT project_id FROM project_members WHERE user_id = ?) "
        "OR NOT EXISTS (SELECT 1 FROM project_members "
        "WHERE project_members.project_id = projects.id) "
        "ORDER BY created_at DESC",
        (user["id"],),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/users")
def list_users(role: str | None = None,
               authorization: str | None = Header(default=None)):
    """Pre-registered accounts for the admin assignment UI. Admin-only so
    one account cannot enumerate every user in the system."""
    _require_admin(authorization)
    conn = get_db()
    cursor = conn.cursor()
    if role:
        if role not in ALLOWED_ROLES:
            conn.close()
            raise HTTPException(status_code=400, detail="Unknown role.")
        cursor.execute("SELECT * FROM users WHERE role = ? ORDER BY name",
                       (role,))
    else:
        cursor.execute("SELECT * FROM users ORDER BY name")
    rows = cursor.fetchall()
    conn.close()
    return [_public_user(r) for r in rows]


@app.put("/api/projects/{project_id}/assignments")
def set_project_assignments(project_id: int, req: AssignmentRequest,
                            authorization: str | None = Header(default=None)):
    """Admin replaces the member set of one project. Unknown user ids are
    rejected (400) — assignments can never point at nobody."""
    _require_admin(authorization)
    user_ids = sorted(set(req.user_ids or []))
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
    if cursor.fetchone() is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    for uid in user_ids:
        cursor.execute("SELECT id, role FROM users WHERE id = ?", (uid,))
        if cursor.fetchone() is None:
            conn.close()
            raise HTTPException(status_code=400,
                                detail=f"Unknown user id: {uid}")
    cursor.execute("DELETE FROM project_members WHERE project_id = ?",
                   (project_id,))
    for uid in user_ids:
        cursor.execute(
            "INSERT INTO project_members (project_id, user_id) VALUES (?, ?)",
            (project_id, uid))
    conn.commit()
    conn.close()
    return {"project_id": project_id, "assigned_user_ids": user_ids}


@app.post("/api/projects")
def create_project(project: Project):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO projects (name, description, status, total_budget, progress) "
        "VALUES (?, ?, ?, ?, ?)",
        (project.name, project.description, project.status or "Active",
         project.total_budget if project.total_budget is not None else 0,
         project.progress if project.progress is not None else 0),
    )
    conn.commit()
    project_id = cursor.lastrowid
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row)


@app.get("/api/projects/{project_id}")
def get_project(project_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return dict(row)


@app.put("/api/projects/{project_id}")
def update_project(project_id: int, upd: ProjectUpdate):
    fields = {k: v for k, v in
              {"name": upd.name, "description": upd.description,
               "status": upd.status, "total_budget": upd.total_budget,
               "progress": upd.progress}.items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
    if cursor.fetchone() is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    cursor.execute(
        f"UPDATE projects SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
        (*fields.values(), project_id),
    )
    conn.commit()
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row)


# ---------------- Budget intelligence (Phase 9) ----------------
# The CPI forecast (EAC = spent / progress) connected to actual rows:
# spend drivers from inventory consumption, burn per progress point,
# committed-but-unspent liability, and delay signals. The AI explains
# using these contributor strings — never from thin air.

def _inr_compact(value):
    """₹5.0 Cr / ₹60 Lakh / full ₹ for small sums. None -> '—'."""
    if value is None:
        return "—"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "—"
    sign = "-" if v < 0 else ""
    a = abs(v)
    if a >= 1e7:
        return f"{sign}₹{a / 1e7:.1f} Cr"
    if a >= 1e5:
        return f"{sign}₹{a / 1e5:.0f} Lakh"
    return _inr(v)


def _delay_signals(cursor, project_id):
    """Honest schedule-visibility signals from rows (no invented dates)."""
    from datetime import date as _date
    out = []
    insp = cursor.execute("SELECT * FROM inspections WHERE project_id = ?",
                          (project_id,)).fetchall()
    bad = [r for r in insp if (r["status"] or "").lower() in
           ("attention", "delayed", "fail", "failed")]
    if bad:
        out.append(f"{len(bad)} of {len(insp)} inspection(s) need attention")
    dates = []
    for r in insp:
        try:
            v = r["log_date"] if "log_date" in r.keys() else None
            if v:
                dates.append(_date.fromisoformat(str(v)[:10]))
        except (TypeError, ValueError):
            pass
    if dates:
        stale = (_date.today() - max(dates)).days
        if stale >= 3:
            out.append(f"No daily update for {stale} days")
    elif insp:
        out.append("Updates carry no dates — visibility gap")
    else:
        out.append("No daily updates on record")
    st = cursor.execute("SELECT status FROM projects WHERE id = ?",
                        (project_id,)).fetchone()
    if st and (st["status"] or "Active") not in ("Active", "Completed"):
        out.append(f"Project status is '{st['status']}'")
    return out


def _spend_drivers(cursor, project_id, spent, limit=5):
    rows = cursor.execute("SELECT * FROM materials WHERE project_id = ?",
                          (project_id,)).fetchall()
    drivers = []
    for m in rows:
        s = float(m["cost"] or 0) * float(m["used_qty"] or 0)
        if s > 0:
            drivers.append({
                "name": m["name"], "unit": m["unit"] or "units",
                "used_qty": float(m["used_qty"] or 0),
                "cost": float(m["cost"] or 0), "spend": s,
                "share_pct": round(100.0 * s / spent, 1) if spent > 0 else 0.0,
            })
    drivers.sort(key=lambda d: -d["spend"])
    return drivers[:limit]


@app.get("/api/projects/{project_id}/budget-intel")
def budget_intel(project_id: int):
    return _budget_intel_data(project_id)


def _budget_intel_data(project_id: int) -> dict:
    """Phase 11: shared builder behind the endpoint and the budget tool."""
    conn = get_db()
    cursor = conn.cursor()
    row = cursor.execute("SELECT * FROM projects WHERE id = ?",
                         (project_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    spent = _actual_spent(cursor, project_id)
    calc = _calc_budget(_col(row, "total_budget", 0), spent,
                        _col(row, "progress", 0))
    drivers = _spend_drivers(cursor, project_id, spent)
    mats = cursor.execute("SELECT * FROM materials WHERE project_id = ?",
                          (project_id,)).fetchall()
    committed = sum(max(0.0, float(m["required_qty"] or 0)
                        - float(m["received_qty"] or 0))
                    * float(m["cost"] or 0) for m in mats)
    burn_pt = (spent / calc["progress"]) if calc["progress"] > 0 and spent > 0 else None
    delays = _delay_signals(cursor, project_id)
    conn.close()
    contributors = []
    for d in drivers[:3]:
        contributors.append(
            f"{d['name']}: {_inr_compact(d['spend'])} "
            f"({d['share_pct']}% of spend — {d['used_qty']:g} {d['unit']} "
            f"@ {_inr_compact(d['cost'])})")
    if burn_pt is not None:
        contributors.append(
            f"Burn rate {_inr_compact(burn_pt)} per 1% progress")
    if committed > 0:
        contributors.append(
            f"{_inr_compact(committed)} still committed on unordered quantities")
    contributors += [f"Delay signal: {s}" for s in delays[:3]]
    if calc["predicted"] is None:
        contributors.append(f"No forecast yet ({calc['note']})")
    return {
        "project_id": project_id,
        "project_name": row["name"],
        "progress": calc["progress"],
        "original_budget": calc["total_budget"],
        "spent": spent,
        "remaining": calc["remaining"],
        "predicted_final": calc["predicted"],
        "overrun": calc["overrun"],
        "overrun_pct": calc["overrun_pct"],
        "risk": calc["risk"],
        "note": calc["note"],
        "formatted": {
            "original": _inr_compact(calc["total_budget"]),
            "spent": _inr_compact(spent),
            "predicted": _inr_compact(calc["predicted"]),
            "overrun": (_inr_compact(calc["overrun"])
                        if calc["overrun"] is not None and calc["overrun"] > 0
                        else ("Within budget" if calc["overrun"] is not None
                              else "—")),
        },
        "spend_drivers": drivers,
        "burn_per_point": burn_pt,
        "committed_unspent": committed,
        "delay_signals": delays,
        "contributors": contributors,
    }


@app.get("/api/projects/{project_id}/budget")
def project_budget(project_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    project_name = row["name"]
    total_budget = _col(row, "total_budget", 0)
    progress = _col(row, "progress", 0)
    spent = _actual_spent(cursor, project_id)
    conn.close()
    calc = _calc_budget(total_budget, spent, progress)
    return {
        "project_id": project_id,
        "project_name": project_name,
        **calc,
    }


# Material endpoints
@app.get("/api/materials")
def list_materials(project_id: int | None = None):
    conn = get_db()
    cursor = conn.cursor()
    if project_id:
        cursor.execute(
            "SELECT * FROM materials WHERE project_id = ? ORDER BY name",
            (project_id,))
    else:
        cursor.execute("SELECT * FROM materials ORDER BY name")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/materials")
def create_material(material: Material):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO materials (project_id, name, category, cost, required_qty, "
        "received_qty, used_qty, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (material.project_id, material.name, material.category, material.cost,
         material.required_qty or 0, material.received_qty or 0,
         material.used_qty or 0, material.unit or "units"),
    )
    conn.commit()
    material_id = cursor.lastrowid
    cursor.execute("SELECT * FROM materials WHERE id = ?", (material_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row)


# Inspection endpoints
@app.get("/api/inspections")
def list_inspections(project_id: int | None = None):
    conn = get_db()
    cursor = conn.cursor()
    if project_id:
        cursor.execute(
            "SELECT * FROM inspections WHERE project_id = ? ORDER BY id DESC",
            (project_id,))
    else:
        cursor.execute("SELECT * FROM inspections ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/inspections")
def create_inspection(inspection: Inspection):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO inspections (project_id, status, notes) VALUES (?, ?, ?)",
        (inspection.project_id, inspection.status, inspection.notes),
    )
    conn.commit()
    inspection_id = cursor.lastrowid
    cursor.execute("SELECT * FROM inspections WHERE id = ?", (inspection_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row)


# ---------------- Safety register (risks / safety issues / PPE) ----------------
# Daily Updates polls these per project. Tables are created in init_db();
# pre-existing databases gain them via CREATE TABLE IF NOT EXISTS on restart.

@app.get("/api/safety_issues")
def list_safety_issues(project_id: int | None = None,
                       status: str | None = None):
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM safety_issues"
    clauses, params = [], []
    if project_id:
        clauses.append("project_id = ?")
        params.append(project_id)
    if status:
        clauses.append("COALESCE(status, 'confirmed') = ?")
        params.append(status)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY id DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/safety_issues/{issue_id}/confirm")
def confirm_safety_issue(issue_id: int):
    """A supervisor verified the AI finding — it joins the engine as fact."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM safety_issues WHERE id = ?", (issue_id,))
    row = cursor.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Issue not found")
    cursor.execute("UPDATE safety_issues SET status = 'confirmed' WHERE id = ?",
                   (issue_id,))
    conn.commit()
    cursor.execute("SELECT * FROM safety_issues WHERE id = ?", (issue_id,))
    out = dict(cursor.fetchone())
    conn.close()
    return out


@app.post("/api/safety_issues/{issue_id}/dismiss")
def dismiss_safety_issue(issue_id: int):
    """A supervisor rejected the AI finding — closed, kept for audit."""
    from datetime import datetime as _dt
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM safety_issues WHERE id = ?", (issue_id,))
    row = cursor.fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Issue not found")
    cursor.execute(
        "UPDATE safety_issues SET status = 'dismissed', resolved_at = ? "
        "WHERE id = ?",
        (_dt.now().strftime("%Y-%m-%d %H:%M:%S"), issue_id))
    conn.commit()
    cursor.execute("SELECT * FROM safety_issues WHERE id = ?", (issue_id,))
    out = dict(cursor.fetchone())
    conn.close()
    return out


@app.get("/api/risks")
def list_risks(project_id: int | None = None, severity: str | None = None):
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM risks"
    clauses, params = [], []
    if project_id:
        clauses.append("project_id = ?")
        params.append(project_id)
    if severity:
        clauses.append("severity = ?")
        params.append(severity)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY id DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/ppe_violations")
def list_ppe_violations(project_id: int | None = None, severity: str | None = None):
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM ppe_violations"
    clauses, params = [], []
    if project_id:
        clauses.append("project_id = ?")
        params.append(project_id)
    if severity:
        clauses.append("severity = ?")
        params.append(severity)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY id DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------- Recurring issue detection ----------------
# Same issue + same/similar location + multiple occurrences + time window.
# Counts ALWAYS come from this query over safety_issues (the incident
# register fed by confirmed daily updates). The LLM may narrate the
# evidence, but it never produces the numbers.

def _issue_fingerprint(title: str) -> str:
    """Normalize an issue title so repeat reports group together:
    case/punctuation-insensitive, whitespace-collapsed. Digits stay (Floor
    3 ≠ Floor 4 is handled by the separate location key)."""
    import re
    t = (title or "").lower()
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    return re.sub(r"\s+", " ", t).strip() or "untitled"


def _issue_location_key(cursor, project_id, row):
    """Resolve where an incident happened. Returns (key, label).
    Preference: modelled area (area_id) → known area name found in the
    text → explicit 'Area X' mention → site → project level. Anything
    unmatched groups at its own level instead of being forced together."""
    import re
    area_id = None
    try:
        area_id = row["area_id"] if "area_id" in row.keys() else None
    except Exception:
        area_id = None
    site_id = None
    try:
        site_id = row["site_id"] if "site_id" in row.keys() else None
    except Exception:
        site_id = None
    if area_id:
        a = cursor.execute(
            "SELECT areas.name, sites.name AS site FROM areas "
            "LEFT JOIN sites ON sites.id = areas.site_id WHERE areas.id = ?",
            (area_id,)).fetchone()
        if a:
            return (f"area:{area_id}",
                    f"{a['name']}" + (f" ({a['site']})" if a["site"] else ""))
    text = f"{row['title'] or ''} {row['description'] or ''}"
    known = cursor.execute(
        "SELECT areas.id, areas.name FROM areas JOIN sites ON sites.id = "
        "areas.site_id WHERE sites.project_id = ?", (project_id,)).fetchall()
    for k in known:
        if k["name"] and k["name"].strip().lower() in text.lower():
            return (f"area:{k['id']}", k["name"])
    m = re.search(r"\b(?:area|zone|block)\s+([A-Za-z0-9]+)", text, re.I)
    if m:
        return (f"area-text:{m.group(0).strip().lower()}", m.group(0).strip())
    if site_id:
        s = cursor.execute("SELECT name FROM sites WHERE id = ?",
                           (site_id,)).fetchone()
        return (f"site:{site_id}", s["name"] if s and s["name"] else f"Site #{site_id}")
    return (f"project:{project_id}", "whole site")


def _parse_ts(value):
    from datetime import datetime
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        return None


def _recurring_groups(project_id=None, days=14, min_occurrences=3):
    """Group open incidents in the window; return groups at/above threshold,
    sorted by occurrences desc. Pure read — safe to call from chat context."""
    from datetime import datetime, timedelta
    try:
        days = max(1, min(90, int(days)))
    except (TypeError, ValueError):
        days = 14
    try:
        min_occurrences = max(2, min(50, int(min_occurrences)))
    except (TypeError, ValueError):
        min_occurrences = 3
    cutoff = datetime.now() - timedelta(days=days)
    conn = get_db()
    cursor = conn.cursor()
    if project_id:
        rows = cursor.execute(
            "SELECT * FROM safety_issues WHERE project_id = ? "
            "AND resolved_at IS NULL ORDER BY reported_at DESC",
            (project_id,)).fetchall()
    else:
        rows = cursor.execute(
            "SELECT * FROM safety_issues WHERE resolved_at IS NULL "
            "ORDER BY reported_at DESC").fetchall()
    groups = {}
    for r in rows:
        ts = _parse_ts(r["reported_at"]) if "reported_at" in r.keys() else None
        if ts is None or ts < cutoff:
            continue
        pid = r["project_id"]
        cat = ((r["category"] or "General").strip() or "General")
        fp = _issue_fingerprint(r["title"])
        lockey, loclabel = _issue_location_key(cursor, pid, r)
        key = (pid, cat.lower(), fp, lockey)
        g = groups.get(key)
        if g is None:
            pname = cursor.execute("SELECT name FROM projects WHERE id = ?",
                                   (pid,)).fetchone()
            g = groups[key] = {
                "project_id": pid,
                "project_name": pname["name"] if pname else f"Project #{pid}",
                "category": cat,
                "issue": fp,
                "location": loclabel,
                "occurrences": 0,
                "occurrence_ids": [],
                "evidence": [],
                "severities": {},
                "first_seen": None,
                "last_seen": None,
                "exemplar": (r["title"] or "").strip()[:140],
            }
        g["occurrences"] += 1
        g["occurrence_ids"].append(r["id"])
        sev = (r["severity"] or "Medium")
        g["severities"][sev] = g["severities"].get(sev, 0) + 1
        iso = ts.isoformat(timespec="seconds")
        g["evidence"].append({"id": r["id"], "title": (r["title"] or "")[:140],
                              "reported_at": iso, "severity": sev})
        if g["first_seen"] is None or iso < g["first_seen"]:
            g["first_seen"] = iso
        if g["last_seen"] is None or iso > g["last_seen"]:
            g["last_seen"] = iso
            g["exemplar"] = (r["title"] or "").strip()[:140]
    conn.close()
    out = []
    for g in groups.values():
        if g["occurrences"] >= min_occurrences:
            g["window_days"] = days
            g["message"] = (
                f"⚠️ Recurring issue detected in {g['location']}: "
                f"{g['exemplar']} — {g['occurrences']} occurrences "
                f"in the last {days} days.")
            out.append(g)
    out.sort(key=lambda g: (-g["occurrences"], g["location"]))
    return out


@app.get("/api/issues/recurring")
def recurring_issues(project_id: int | None = None, days: int = 14,
                     min_occurrences: int = 3):
    """DB-counted recurring incidents. Same issue + same location +
    >= min_occurrences within the last `days` days."""
    groups = _recurring_groups(project_id, days, min_occurrences)
    return {"window_days": max(1, min(90, int(days or 14))),
            "min_occurrences": max(2, min(50, int(min_occurrences or 3))),
            "groups": groups}
# Pipeline: browser mic -> speech-to-text -> AI extraction -> user
# confirmation -> saved as an inspection row (source='voice') with the
# transcript + structured JSON attached. Safety findings also fan out to
# safety_issues and material-shortage notes to risks, so the existing
# Risk/APIs and the AI assistant see them like any other record.

# ---------------- Risk Engine (Phase 6) ----------------
# Deterministic 0-100 scores per dimension from live rows, each with WHY
# reasons carrying exact counts/IDs. Bands: >=75 HIGH, >=50 MEDIUM, >=25
# LOW, else MINIMAL. Composite Project = weighted mean (documented below).
# The LLM explains using these numbers; it never invents its own.

def _risk_band(score: int) -> str:
    if score >= 75:
        return "HIGH"
    if score >= 50:
        return "MEDIUM"
    if score >= 25:
        return "LOW"
    return "MINIMAL"


def _risk_scores(project_id: int) -> dict:
    """Full risk report for one project. Pure read; safe for chat context."""
    from datetime import date as _date
    conn = get_db()
    cursor = conn.cursor()
    proj = cursor.execute("SELECT * FROM projects WHERE id = ?",
                          (project_id,)).fetchone()
    if proj is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")

    # ---- Safety: open incidents + recurrence + PPE load + 7-day velocity.
    safety_open = cursor.execute(
        "SELECT * FROM safety_issues WHERE project_id = ? "
        "AND resolved_at IS NULL", (project_id,)).fetchall()
    n_high = sum(1 for r in safety_open if (r["severity"] or "") == "High")
    n_med = sum(1 for r in safety_open if (r["severity"] or "") == "Medium")
    n_low = sum(1 for r in safety_open if (r["severity"] or "") not in ("High", "Medium"))
    n_ppe = sum(1 for r in safety_open if (r["category"] or "") == "PPE")
    try:
        recur = _recurring_groups(project_id, 14, 3)
    except Exception:
        recur = []
    max_occ = max([g["occurrences"] for g in recur], default=0)
    recent7 = 0
    for r in safety_open:
        ts = _parse_ts(r["reported_at"]) if "reported_at" in r.keys() else None
        if ts is not None and (datetime_now() - ts).days < 7:
            recent7 += 1
    safety = min(100, min(n_high * 12, 48) + min(n_med * 5, 20)
                 + min(n_low * 2, 6) + min(len(recur) * 8, 24)
                 + min(max(0, max_occ - 2) * 2, 12)
                 + (8 if safety_open and n_ppe * 2 >= len(safety_open) else 0)
                 + (10 if recent7 >= 3 else (4 if recent7 >= 1 else 0)))
    safety_reasons = []
    if n_ppe:
        safety_reasons.append(f"{n_ppe} open PPE violation(s)")
    if len(safety_open) - n_ppe > 0:
        safety_reasons.append(
            f"{len(safety_open) - n_ppe} other unresolved incident(s)")
    for g in recur[:3]:
        safety_reasons.append(
            f"Recurring: {g['exemplar']} in {g['location']} — "
            f"{g['occurrences']}× in {g['window_days']} days")
    if recent7 >= 3:
        safety_reasons.append(f"{recent7} new incident(s) in the last 7 days")
    if not safety_open and not recur:
        safety_reasons.append("No open incidents, no repeats in 14 days")

    # ---- Inventory: shortfalls + open resource risks + burn-through.
    mats = cursor.execute("SELECT * FROM materials WHERE project_id = ?",
                          (project_id,)).fetchall()
    short = [m for m in mats
             if (m["required_qty"] or 0) > 0
             and (m["received_qty"] or 0) < (m["required_qty"] or 0)]
    res_risks = cursor.execute(
        "SELECT * FROM risks WHERE project_id = ? AND category = 'Resource' "
        "AND COALESCE(status, 'open') = 'open'", (project_id,)).fetchall()
    burnt = [m for m in mats if (m["received_qty"] or 0) > 0
             and (m["used_qty"] or 0) >= 0.9 * (m["received_qty"] or 0)]
    if not mats:
        inventory, inventory_reasons = 20, ["No inventory records (blind spot)"]
    else:
        inventory = min(100, min(len(short) * 15, 45)
                        + min(len(res_risks) * 8, 24)
                        + min(len(burnt) * 8, 16))
        inventory_reasons = []
        for m in short[:4]:
            gap = (m["required_qty"] or 0) - (m["received_qty"] or 0)
            inventory_reasons.append(
                f"{m['name']} short by {gap:g} {m['unit'] or 'units'} "
                f"({(m['received_qty'] or 0):g}/{(m['required_qty'] or 0):g} received)")
        for m in burnt[:3]:
            pct = 100.0 * (m["used_qty"] or 0) / (m["received_qty"] or 1)
            inventory_reasons.append(
                f"{m['name']} consumed {pct:.0f}% of received stock")
        if res_risks:
            inventory_reasons.append(
                f"{len(res_risks)} open material-shortage risk(s)")
        if not inventory_reasons:
            inventory_reasons.append("Stock levels cover requirements")

    # ---- Budget: earned-value forecast mapped to 0-100.
    spent = _actual_spent(cursor, project_id)
    calc = _calc_budget(_col(proj, "total_budget", 0), spent,
                        _col(proj, "progress", 0))
    if calc["predicted"] is None:
        budget, budget_reasons = 15, [calc["note"] or "No forecast possible"]
    else:
        op = calc["overrun_pct"] or 0
        if op > 10:
            budget = min(95, round(55 + op))
        elif op > 0:
            budget = round(40 + op * 1.5)
        else:
            budget = max(5, round(25 + op))
        budget = max(0, min(100, budget))
        budget_reasons = [
            f"Forecast {_inr(calc['predicted'])} vs budget "
            f"{_inr(calc['total_budget'])} "
            f"(overrun {_inr(calc['overrun'])} / {op:.1f}%)"]
        if budget >= 75:
            budget_reasons.append("Burn rate exceeds plan — HIGH overrun risk")

    # ---- Schedule: attention share + status + stale updates + high risks.
    insp = cursor.execute("SELECT * FROM inspections WHERE project_id = ?",
                          (project_id,)).fetchall()
    bad = [r for r in insp if (r["status"] or "").lower() in
           ("attention", "delayed", "fail", "failed", "pending")]
    share_pts = round((len(bad) / len(insp)) * 50) if insp else 0
    st = (proj["status"] or "Active") if "status" in proj.keys() else "Active"
    status_pts = 20 if st in ("Pending", "Delayed", "On Hold") else 0
    hi_risks = cursor.execute(
        "SELECT COUNT(*) FROM risks WHERE project_id = ? AND severity = 'High' "
        "AND COALESCE(status, 'open') = 'open'", (project_id,)).fetchone()[0]
    hi_pts = min(int(hi_risks) * 8, 24)
    log_dates = []
    for r in insp:
        try:
            v = r["log_date"] if "log_date" in r.keys() else None
            if v:
                log_dates.append(_date.fromisoformat(str(v)[:10]))
        except (TypeError, ValueError):
            pass
    if log_dates:
        stale = (_date.today() - max(log_dates)).days
        stale_pts = 15 if stale >= 7 else (8 if stale >= 3 else 0)
    elif insp:
        stale, stale_pts = None, 8
    else:
        stale, stale_pts = None, 15
    schedule = min(100, share_pts + status_pts + hi_pts + stale_pts)
    schedule_reasons = []
    if insp:
        schedule_reasons.append(
            f"{len(bad)} of {len(insp)} inspection(s) need attention")
    else:
        schedule_reasons.append("No inspections on record")
    if status_pts:
        schedule_reasons.append(f"Project status is '{st}'")
    if hi_risks:
        schedule_reasons.append(f"{hi_risks} open HIGH risk(s)")
    if log_dates:
        if stale >= 3:
            schedule_reasons.append(
                f"No daily update for {stale} days (last {max(log_dates).isoformat()})")
        else:
            schedule_reasons.append(
                f"Last daily update {max(log_dates).isoformat()} (fresh)")
    elif stale_pts:
        schedule_reasons.append("No dated daily updates — site visibility gap")

    # ---- Hotspot: location carrying the most open incidents.
    hot_counts, hot_labels = {}, {}
    for r in safety_open:
        try:
            key, label = _issue_location_key(cursor, project_id, r)
        except Exception:
            continue
        hot_counts[key] = hot_counts.get(key, 0) + 1
        hot_labels[key] = label
    hotspot = {"label": None, "level": "MINIMAL", "open_incidents": 0,
               "recurring_occurrences": 0}
    if hot_counts:
        top = max(hot_counts, key=lambda k: hot_counts[k])
        rec_occ = 0
        for g in recur:
            if g["location"] == hot_labels[top]:
                rec_occ = max(rec_occ, g["occurrences"])
        n = hot_counts[top]
        level = ("HIGH" if (n >= 5 or rec_occ >= 5)
                 else ("MEDIUM" if (n >= 3 or rec_occ >= 3) else "LOW"))
        hotspot = {"label": hot_labels[top], "level": level,
                   "open_incidents": n, "recurring_occurrences": rec_occ}

    project = min(100, round(0.35 * safety + 0.20 * inventory
                             + 0.20 * budget + 0.25 * schedule))
    why = []
    if hotspot["label"]:
        why.append(f"{hotspot['level']} RISK — {hotspot['label']} "
                   f"({hotspot['open_incidents']} open incident(s))")
    why += safety_reasons[:2] + inventory_reasons[:1] + budget_reasons[:1] \
        + schedule_reasons[:1]
    why = why[:6]

    conn.close()
    scores = {"project": project, "safety": safety, "inventory": inventory,
              "budget": budget, "schedule": schedule}
    return {
        "project_id": project_id,
        "project_name": proj["name"],
        "scores": scores,
        "bands": {k: _risk_band(v) for k, v in scores.items()},
        "hotspot": hotspot,
        "dimensions": {
            "safety": {"score": safety, "reasons": safety_reasons},
            "inventory": {"score": inventory, "reasons": inventory_reasons},
            "budget": {"score": budget,
                       "reasons": budget_reasons,
                       "forecast": {k: calc[k] for k in
                                    ("predicted", "overrun", "overrun_pct",
                                     "risk")}},
            "schedule": {"score": schedule, "reasons": schedule_reasons},
        },
        "top_reasons": why,
    }


def datetime_now():
    from datetime import datetime
    return datetime.now()


@app.get("/api/risks/score")
def risk_score(project_id: int):
    """Explainable 0-100 risk: safety / inventory / budget / schedule +
    weighted project composite, every point backed by row counts."""
    return _risk_scores(project_id)


# ---------------- Risk heatmap (Phase 7) ----------------
# Site → Building → Floor → Area tree with per-area risk dots. Every
# signal is attributed once: modelled areas own exact matches, site-wide
# rows stay at site level, and free-text locations matching nothing appear
# under "unmapped" instead of being forced into an area. Scores reuse the
# engine bands (>=75 HIGH, >=50 MEDIUM, >=25 LOW, else MINIMAL).

def _heat_norm(text) -> str:
    return (text or "").strip().lower()


def _heat_bucket():
    return {"incidents": [], "observations": [], "updates": [],
            "ai": [], "recurring": [], "attention": 0,
            "compliance": None, "open_hi": 0, "open_med": 0, "open_low": 0,
            "recur_occ": 0}


def _heat_compliance(details_text):
    try:
        d = json.loads(details_text or "{}")
    except Exception:
        return None
    for k in ("compliance_pct", "helmet_compliance_pct"):
        try:
            v = d.get(k)
            if v is not None:
                return float(v)
        except (TypeError, ValueError):
            pass
    return None


def _heat_area_score(b: dict) -> tuple:
    """(score, reasons). 0 with 'no signals recorded' when empty."""
    if (not b["incidents"] and not b["observations"] and not b["updates"]
            and not b["recurring"]):
        return (0, ["No signals recorded for this area"])
    score = (min(b["open_hi"] * 15, 45) + min(b["open_med"] * 6, 18)
             + min(b["open_low"] * 2, 6) + min(b["recur_occ"] * 3, 15)
             + min(b["attention"] * 5, 10))
    comp = b["compliance"]
    if comp is not None and comp < 50:
        score += 15
    elif comp is not None and comp < 80:
        score += 10
    score = min(100, score)
    reasons = []
    if b["open_hi"]:
        reasons.append(f"{b['open_hi']} open HIGH incident(s)")
    if b["open_med"]:
        reasons.append(f"{b['open_med']} open MEDIUM incident(s)")
    if b["recur_occ"]:
        reasons.append(f"Repeats {b['recur_occ']}× in 14 days")
    if b["attention"]:
        reasons.append(f"{b['attention']} update(s) flagged Attention")
    if comp is not None and comp < 80:
        reasons.append(f"Latest AI compliance {comp:.0f}%")
    if not reasons:
        reasons.append("Signals present, none severe")
    return (score, reasons)


def _heat_actions(area_label, b: dict, score_reasons: list) -> list:
    acts = []
    if b["open_hi"]:
        acts.append(f"Stop-work review: resolve {b['open_hi']} HIGH incident(s) "
                    f"in {area_label} before resuming normal work.")
    for g in b["recurring"][:2]:
        if "ppe" in (g.get("category") or "").lower() or \
                "helmet" in (g.get("exemplar") or "").lower():
            acts.append(f"Run daily PPE toolbox talks in {area_label} "
                        f"({g['occurrences']} repeats in 14 days); assign a "
                        f"supervisor to verify.")
        else:
            acts.append(f"Investigate root cause of '{g.get('exemplar')}' in "
                        f"{area_label} — {g['occurrences']}× in 14 days.")
    comp = b["compliance"]
    if comp is not None and comp < 80:
        acts.append(f"Helmet compliance {comp:.0f}% — re-scan with SiteVision "
                    f"after correction.")
    if b["attention"]:
        acts.append(f"{b['attention']} update(s) flagged Attention — review "
                    f"the latest notes.")
    if not acts:
        acts.append("No action required — area is clear.")
    return acts[:5]


@app.get("/api/sites/heatmap")
def sites_heatmap(project_id: int):
    return _heatmap_data(project_id)


def _heatmap_data(project_id: int) -> dict:
    """Phase 11: shared builder behind the endpoint and the area tool."""
    conn = get_db()
    cursor = conn.cursor()
    proj = cursor.execute("SELECT * FROM projects WHERE id = ?",
                          (project_id,)).fetchone()
    if proj is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")

    sites = cursor.execute("SELECT * FROM sites WHERE project_id = ? "
                           "ORDER BY id", (project_id,)).fetchall()
    buildings = cursor.execute(
        "SELECT * FROM buildings WHERE site_id IN "
        "(SELECT id FROM sites WHERE project_id = ?) ORDER BY id",
        (project_id,)).fetchall()
    floors = cursor.execute(
        "SELECT * FROM floors WHERE building_id IN "
        "(SELECT id FROM buildings WHERE site_id IN "
        "(SELECT id FROM sites WHERE project_id = ?)) ORDER BY id",
        (project_id,)).fetchall()
    areas = cursor.execute(
        "SELECT * FROM areas WHERE site_id IN "
        "(SELECT id FROM sites WHERE project_id = ?) ORDER BY id",
        (project_id,)).fetchall()
    by_name = {}
    for a in areas:
        by_name.setdefault(_heat_norm(a["name"]), []).append(a)

    def match_area(site_id, name):
        cands = by_name.get(_heat_norm(name), [])
        if site_id is not None:
            cands = [a for a in cands if a["site_id"] == site_id]
        return cands[0] if len(cands) == 1 else None

    buckets, site_general, unmapped = {}, {}, {}
    for a in areas:
        buckets[a["id"]] = _heat_bucket()

    def put(bucket_map, key, label, fn):
        b = bucket_map.get(key)
        if b is None:
            b = bucket_map[key] = {"label": label, **_heat_bucket()}
        fn(b)

    # Incidents: open + resolved-in-30-days (history for the drawer).
    from datetime import datetime as _dt, timedelta as _td
    recent_cut = (_dt.now() - _td(days=30))
    sincs = cursor.execute(
        "SELECT * FROM safety_issues WHERE project_id = ? ORDER BY id DESC",
        (project_id,)).fetchall()
    for r in sincs:
        resolved = r["resolved_at"] if "resolved_at" in r.keys() else None
        if resolved and (_parse_ts(resolved) or _dt.min) < recent_cut:
            continue
        is_open = not resolved
        try:
            key, label = _issue_location_key(cursor, project_id, r)
        except Exception:
            key, label = f"project:{project_id}", "Whole site"
        item = {"id": r["id"], "title": r["title"], "category": r["category"],
                "severity": r["severity"], "reported_at": r["reported_at"],
                "resolved": bool(resolved)}
        if key.startswith("area:"):
            try:
                aid = int(key.split(":", 1)[1])
            except ValueError:
                aid = None
            if aid in buckets:
                b = buckets[aid]
                b["incidents"].append(item)
                if is_open:
                    sev = (r["severity"] or "Medium")
                    if sev == "High":
                        b["open_hi"] += 1
                    elif sev == "Medium":
                        b["open_med"] += 1
                    else:
                        b["open_low"] += 1
            else:
                put(unmapped, key, label,
                    lambda b: b["incidents"].append(item))
        elif key.startswith("area-text:"):
            a = match_area(None, label)
            if a is not None:
                b = buckets[a["id"]]
                b["incidents"].append(item)
                if is_open:
                    b["open_med"] += 1
            else:
                put(unmapped, key, label,
                    lambda b: b["incidents"].append(item))
        elif key.startswith("site:"):
            try:
                sid = int(key.split(":", 1)[1])
            except ValueError:
                sid = None
            put(site_general, sid, label,
                lambda b: b["incidents"].append(item))
        else:
            put(unmapped, key, label,
                lambda b: b["incidents"].append(item))

    # Observations + inspections: match modelled area by site + name.
    for o in cursor.execute("SELECT * FROM observations WHERE project_id = ? "
                            "ORDER BY id DESC", (project_id,)).fetchall():
        osite = o["site_id"] if "site_id" in o.keys() else None
        a = match_area(osite, o["area"]) if o["area"] else None
        comp = _heat_compliance(o["details"])
        item = {"id": o["id"], "title": o["title"], "kind": o["kind"],
                "area": o["area"], "created_at": o["created_at"],
                "compliance": comp}
        if a is not None:
            b = buckets[a["id"]]
            b["observations"].append(item)
            if comp is not None and b["compliance"] is None:
                b["compliance"] = comp
            if comp is not None:
                b["ai"].append({"observation_id": o["id"],
                                "compliance": comp, "kind": o["kind"]})
        else:
            put(unmapped, f"name:{_heat_norm(o['area']) or 'unspecified'}",
                o["area"] or "Unspecified location",
                lambda b: b["observations"].append(item))
            if comp is not None:
                ub = unmapped[f"name:{_heat_norm(o['area']) or 'unspecified'}"]
                if ub["compliance"] is None:
                    ub["compliance"] = comp
    for u in cursor.execute("SELECT * FROM inspections WHERE project_id = ? "
                            "ORDER BY id DESC LIMIT 200", (project_id,)).fetchall():
        usite = u["site_id"] if "site_id" in u.keys() else None
        uname = u["area"] if "area" in u.keys() else None
        a = match_area(usite, uname) if uname else None
        item = {"id": u["id"], "status": u["status"],
                "log_date": u["log_date"] if "log_date" in u.keys() else None,
                "source": u["source"] if "source" in u.keys() else None,
                "notes": (u["notes"] or "")[:280]}
        if a is not None:
            b = buckets[a["id"]]
            b["updates"].append(item)
            if (u["status"] or "").lower() in ("attention", "delayed",
                                               "fail", "failed"):
                b["attention"] += 1
        else:
            put(unmapped, f"name:{_heat_norm(uname) or 'unspecified'}",
                uname or "Unspecified location",
                lambda b, i=item: b["updates"].append(i))

    # Recurring groups attach to areas via shared incident IDs.
    incident_area = {}
    for aid, b in buckets.items():
        for it in b["incidents"]:
            incident_area[it["id"]] = aid
    try:
        recur = _recurring_groups(project_id, 14, 3)
    except Exception:
        recur = []
    for g in recur:
        for aid in {incident_area[i] for i in g["occurrence_ids"]
                    if i in incident_area}:
            b = buckets[aid]
            if g not in b["recurring"]:
                b["recurring"].append(g)
                b["recur_occ"] += g["occurrences"]

    def area_payload(a):
        b = buckets[a["id"]]
        score, reasons = _heat_area_score(b)
        return {"id": a["id"], "name": a["name"], "kind": a["kind"],
                "risk": {"score": score, "band": _risk_band(score)},
                "counts": {"incidents_open": b["open_hi"] + b["open_med"]
                           + b["open_low"],
                           "recurring": len(b["recurring"]),
                           "observations": len(b["observations"]),
                           "updates": len(b["updates"]),
                           "ai_detections": len(b["ai"])},
                "latest_compliance": b["compliance"],
                "detail": {
                    "incidents": b["incidents"][:10],
                    "observations": b["observations"][:5],
                    "recurring": [{"message": g["message"],
                                   "occurrences": g["occurrences"],
                                   "exemplar": g["exemplar"],
                                   "evidence": g["evidence"][:6]}
                                  for g in b["recurring"]],
                    "updates": b["updates"][:5],
                    "ai": b["ai"][:5],
                    "reasons": reasons,
                    "actions": _heat_actions(a["name"], b, reasons),
                }}

    out_sites = []
    for s in sites:
        bs = [x for x in buildings if x["site_id"] == s["id"]]
        placed = set()
        b_out = []
        for x in bs:
            fs = [f for f in floors if f["building_id"] == x["id"]]
            f_out = []
            for f in fs:
                ap = [area_payload(a) for a in areas
                      if a["floor_id"] == f["id"]]
                placed.update(p["id"] for p in ap)
                f_out.append({"id": f["id"], "name": f["name"],
                              "level": f["level"], "areas": ap})
            # Building-direct areas (building set, no floor in this building).
            bdir = [area_payload(a) for a in areas
                    if a["building_id"] == x["id"] and a["id"] not in placed]
            placed.update(p["id"] for p in bdir)
            b_out.append({"id": x["id"], "name": x["name"], "floors": f_out,
                          "direct_areas": bdir})
        # Site-direct areas (neither building nor floor).
        site_loose = [area_payload(a) for a in areas
                      if a["site_id"] == s["id"] and a["id"] not in placed]
        sg = site_general.get(s["id"], _heat_bucket())
        out_sites.append({"id": s["id"], "name": s["name"],
                          "location": s["location"], "buildings": b_out,
                          "site_areas": site_loose,
                          "site_general_incidents": len(sg["incidents"])})

    unmapped_out = [{"label": v["label"],
                     "counts": {"incidents": len(v["incidents"]),
                                "observations": len(v["observations"]),
                                "updates": len(v["updates"])},
                     "incidents": [{"id": i["id"], "title": i["title"],
                                    "severity": i.get("severity"),
                                    "reported_at": i.get("reported_at")}
                                   for i in v["incidents"][:5]],
                     "updates": [{"id": u["id"],
                                  "log_date": u.get("log_date"),
                                  "status": u.get("status"),
                                  "notes": (u.get("notes") or "")[:140]}
                                 for u in v["updates"][:5]]}
                    for v in unmapped.values()]
    conn.close()
    return {"project_id": project_id, "project_name": proj["name"],
            "sites": out_sites, "unmapped": unmapped_out}


# ---------------- Inventory intelligence (Phase 8) ----------------
# Consumption-based forecast per material — deliberately NOT ML. Burn rate
# is measured from quantities supervisors confirmed in daily updates over
# the window; with no signal the answer is "unknown", never zero.
#   stock = received - used
#   daily = SUM(matched mention qty in window) / window_days
#   days_remaining = floor(stock / daily)      (null when unknown)
#   upcoming_requirement = max(0, required - received)
# SHORTAGE when: stock already negative | stock < upcoming requirement |
# at current burn the pile runs out within 7 days.

def _forecast_report(project_id: int, window_days: int = 14) -> dict:
    import math
    from datetime import date as _date
    try:
        window_days = max(7, min(60, int(window_days)))
    except (TypeError, ValueError):
        window_days = 14
    conn = get_db()
    cursor = conn.cursor()
    proj = cursor.execute("SELECT * FROM projects WHERE id = ?",
                          (project_id,)).fetchone()
    if proj is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    mats = cursor.execute("SELECT * FROM materials WHERE project_id = ? "
                          "ORDER BY name", (project_id,)).fetchall()
    cutoff = _date.today().toordinal()
    burn, burn_hits, mentions, unmatched = {}, {}, 0, []
    for u in cursor.execute(
            "SELECT log_date, structured FROM inspections "
            "WHERE project_id = ?", (project_id,)).fetchall():
        try:
            when = _date.fromisoformat(str(u["log_date"])[:10]).toordinal()
        except (TypeError, ValueError):
            continue
        if cutoff - when >= window_days:
            continue
        try:
            items = (json.loads(u["structured"] or "{}")).get("materials", [])
        except Exception:
            continue
        for m in items:
            if not isinstance(m, dict):
                continue
            name = str(m.get("name") or "").strip()
            try:
                q = float(m.get("qty"))
            except (TypeError, ValueError):
                continue
            if not name or q is None or q <= 0:
                continue
            match, ambiguous = _match_project_material(
                cursor, project_id, name)
            if match is None or ambiguous:
                unmatched.append({
                    "name": name, "qty": q,
                    "unit": m.get("unit"),
                    "log_date": u["log_date"],
                    "reason": ("several inventory items share this name"
                               if ambiguous else
                               "no such item in project inventory")})
                continue
            burn[match["id"]] = burn.get(match["id"], 0.0) + q
            burn_hits[match["id"]] = burn_hits.get(match["id"], 0) + 1
            mentions += 1
    items_out, shortages = [], 0
    for m in mats:
        received = float(m["received_qty"] or 0)
        used = float(m["used_qty"] or 0)
        required = float(m["required_qty"] or 0)
        stock = received - used
        total = burn.get(m["id"], 0.0)
        daily = (total / window_days) if total > 0 else None
        days_left = (math.floor(stock / daily)
                     if daily and stock > 0 else None)
        upcoming = max(0.0, required - received)
        if stock < 0:
            shortage, reason = True, (
                f"Stock already negative ({stock:g} {m['unit'] or 'units'}) — "
                f"used exceeds received; reconcile before forecasting.")
        elif upcoming > 0 and stock < upcoming:
            shortage, reason = True, (
                f"Need {upcoming:g} more {m['unit'] or 'units'} to meet the "
                f"requirement, only {stock:g} on hand.")
        elif days_left is not None and days_left <= 7:
            shortage, reason = True, (
                f"Runs out in ~{days_left} day(s) at ~{daily:g} "
                f"{m['unit'] or 'units'}/day.")
        elif daily is None:
            shortage, reason = False, (
                "No consumption signal in daily updates — monitoring.")
        else:
            shortage, reason = False, "Covers requirement at current burn."
        if shortage:
            shortages += 1
        items_out.append({
            "material_id": m["id"], "name": m["name"],
            "unit": m["unit"] or "units", "cost": m["cost"],
            "required_qty": required, "received_qty": received,
            "used_qty": used, "stock": stock,
            "daily_consumption": daily, "days_remaining": days_left,
            "upcoming_requirement": upcoming,
            "upcoming_cost": upcoming * float(m["cost"] or 0),
            "predicted_shortage": shortage, "reason": reason,
            "mentions": burn_hits.get(m["id"], 0),
        })
    conn.close()
    return {"project_id": project_id, "project_name": proj["name"],
            "window_days": window_days, "materials": items_out,
            "shortage_count": shortages,
            "unmatched_mentions": unmatched[:20]}


@app.get("/api/materials/forecast")
def materials_forecast(project_id: int, window_days: int = 14):
    """Per-material consumption forecast: stock, daily burn measured from
    confirmed daily updates, days remaining, upcoming requirement, and a
    shortage verdict with its reason."""
    return _forecast_report(project_id, window_days)


# ---------------- Voice daily updates ----------------
# Pipeline: browser mic -> speech-to-text -> AI extraction -> user
# confirmation -> saved as an inspection row (source='voice') with the
# transcript + structured JSON attached. Safety findings also fan out to
# safety_issues and material-shortage notes to risks, so the existing
# Risk/APIs and the AI assistant see them like any other record.

class VoiceExtractRequest(BaseModel):
    transcript: str
    project_id: int | None = None


class VoiceSaveRequest(BaseModel):
    project_id: int
    transcript: str
    structured: dict | None = None
    area: str | None = None
    building: str | None = None
    floor: str | None = None
    log_date: str | None = None
    submitted_by: str | None = None
    # Phase 3: the Type path reuses this endpoint with source='typed'.
    # 'voice' = mic recording, 'typed' = typed + AI extract, 'manual' legacy.
    source: str | None = None
    site_id: int | None = None
    # Phase 4: explicit overall-progress percent (typed form's number field).
    # Voice transcripts carry no reliable % — they leave this null and
    # progress is never guessed from prose.
    progress_pct: float | None = None


_VOICE_MATERIALS = [
    "cement", "steel", "rebar", "bricks", "blocks", "sand", "aggregate",
    "gravel", "concrete", "mortar", "plaster", "tiles", "timber", "plywood",
    "paint", "water", "diesel", "fuel", "pipes", "scaffolding", "wire",
    "cable", "glass", "doors", "windows",
]

_VOICE_UNIT_ALIASES = {
    "bag": "bags", "bags": "bags",
    "ton": "tons", "tons": "tons", "tonne": "tons", "tonnes": "tons",
    "kg": "kg", "kgs": "kg",
    "piece": "pieces", "pieces": "pieces", "nos": "pieces", "numbers": "pieces",
    "litre": "litres", "litres": "litres", "liter": "litres", "liters": "litres",
    "load": "loads", "loads": "loads", "truck": "loads", "trucks": "loads",
    "roll": "rolls", "rolls": "rolls",
    "packet": "packets", "packets": "packets",
    "meter": "meters", "meters": "meters", "metre": "meters", "metres": "meters",
    "cum": "m3", "cubic": "m3",
}

_VOICE_LOW_WORDS = [
    "low", "running out", "ran out", "shortage", "shortfall", "short of",
    "need more", "needs more", "order more", "depleting", "depleted",
    "insufficient", "finish soon", "almost over", "stock out",
]

_VOICE_SAFETY_WORDS = [
    "helmet", "hard hat", "hardhat", "ppe", "vest", "harness", "gloves",
    "goggles", "mask", "unsafe", "accident", "injury", "injured", "fall",
    "fell", "hazard", "safety", "collapse", "electrocution", "violation",
    "without", "missing", "not wearing",
]

_VOICE_HIGH_SEV_WORDS = [
    "without", "no ", "not wearing", "missing", "accident", "injur",
    "fall", "fell", "collapse", "electrocut", "hospital", "blood",
]

_VOICE_PROGRESS_VERBS = [
    "complet", "finish", "done", "pour", "poured", "erect", "install",
    "plaster", "paint", "laid", "laying", "construct", "excavat",
    "backfill", "cast", "fixed", "demolish", "waterproof", "curing",
    "cured", "started", "began", "progress", "achieved", "covered",
]

_VOICE_TOMORROW_WORDS = [
    "tomorrow", "next day", "plan", "planned", "planning", "will ",
    "going to", "schedule", "shall ",
]


def _voice_sentences(transcript: str):
    import re
    # Split on sentence ends AND commas: speech-to-text rarely emits
    # periods, so without clause splitting one safety keyword anywhere
    # poisons the whole transcript into a single bucket. Commas inside
    # numbers (1,000 bags) are protected.
    parts = re.split(r"[.!?;\n]+|,(?!\d)", transcript or "")
    clean = [p.strip(" ,\"'") for p in parts if p and p.strip(" ,\"'")]
    if len(clean) == 1 and len(clean[0]) > 120:
        # Still one long clause = raw unpunctuated dictation. Re-split on
        # safe fact boundaries only: time words, worker counts and "and".
        # Material names are deliberately NOT boundaries — "30 bags cement"
        # must stay together or quantities detach from their material.
        sub = re.split(
            r"\s+and\s+"
            r"|(?=\b(?:tomorrow|today|yesterday)\b)"
            r"|(?=\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)"
            r"\s+workers?\b)",
            clean[0], flags=re.I)
        sub = [p.strip(" ,\"'") for p in sub if p and p.strip(" ,\"'")]
        if len(sub) > 1:
            return sub
    return clean


def _voice_location(sentence: str):
    import re
    loc = {"building": None, "floor": None, "area": None}
    m = re.search(r"building\s+([A-Za-z0-9\-]+)", sentence, re.I)
    if m:
        loc["building"] = m.group(1)
    m = re.search(
        r"(?:floor|level)\s*(\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|ground|basement)",
        sentence, re.I)
    if not m:
        m = re.search(
            r"(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+floor",
            sentence, re.I)
    if m:
        loc["floor"] = m.group(1)
    m = re.search(r"area\s+([A-Za-z0-9\-]+)", sentence, re.I)
    if m:
        loc["area"] = m.group(1)
    return loc


def _heuristic_extract(transcript: str) -> dict:
    """Offline rule-based extraction. Never invents: quantities, names and
    places come only from the transcript; unknowns stay null/empty."""
    import re
    text = (transcript or "").strip()
    out = {
        "progress": [], "materials": [], "material_low": [],
        "safety": [], "tomorrow": [], "other": [],
        "locations": {"building": None, "floor": None, "area": None},
        "summary": "",
    }
    if not text:
        return out
    low = text.lower()
    for s in _voice_sentences(text):
        sl = s.lower()
        loc = _voice_location(s)
        for k in ("building", "floor", "area"):
            if loc[k] and not out["locations"][k]:
                out["locations"][k] = loc[k]
        is_safety = any(w in sl for w in _VOICE_SAFETY_WORDS)
        found_mats = [m for m in _VOICE_MATERIALS
                      if re.search(r"\b" + re.escape(m) + r"s?\b", sl)]
        is_tomorrow = any(w in sl for w in _VOICE_TOMORROW_WORDS)
        is_progress = any(v in sl for v in _VOICE_PROGRESS_VERBS)
        if is_safety:
            sev = ("High" if any(w in sl for w in _VOICE_HIGH_SEV_WORDS)
                   else "Medium")
            area = loc["area"] or loc["building"]
            out["safety"].append({
                "title": s[:140], "area": area, "severity": sev})
            continue
        for mat in found_mats:
            qty = unit = None
            # Quantity belongs to the CLOSEST number, preferring one that
            # precedes the material ("30 bags cement", "200 pieces tiles").
            # First-in-sentence matching misreads "Floor 7 ... 30 bags" as 7
            # and gives every material in the clause the same number.
            mi = sl.find(mat)
            cands = [m for m in
                     re.finditer(r"(\d+(?:\.\d+)?)\s*([A-Za-z]+)?", sl)
                     if abs(m.start() - mi) <= 30]
            before = [m for m in cands if m.end() <= mi + 2]
            pool = before or cands
            m = (min(pool, key=lambda x: abs(x.start() - mi))
                 if pool else None)
            if m:
                try:
                    qty = float(m.group(1))
                    if qty.is_integer():
                        qty = int(qty)
                except (TypeError, ValueError):
                    qty = None
                raw_unit = (m.group(2) or "").lower()
                unit = _VOICE_UNIT_ALIASES.get(raw_unit)
            out["materials"].append({
                "name": mat, "qty": qty, "unit": unit, "note": s[:140]})
        if found_mats and any(w in sl for w in _VOICE_LOW_WORDS):
            out["material_low"].append(s[:140])
        elif is_tomorrow:
            out["tomorrow"].append(s[:140])
        elif is_progress:
            if s[:140] not in out["progress"]:
                out["progress"].append(s[:140])
        elif found_mats:
            pass  # pure usage line — already captured under materials
        else:
            out["other"].append(s[:140])
    out["summary"] = (out["progress"] + out["tomorrow"] + out["other"])[:1]
    out["summary"] = out["summary"][0] if out["summary"] else text[:140]
    return out


_EXTRACT_SCHEMA_HINT = (
    '{"progress": ["..."], "materials": [{"name": "...", "qty": 120, '
    '"unit": "bags or null"}], "material_low": ["..."], '
    '"safety": [{"title": "...", "area": "... or null", '
    '"severity": "High/Medium"}], "tomorrow": ["..."], "other": ["..."], '
    '"locations": {"building": null, "floor": null, "area": null}, '
    '"summary": "..."}'
)

_EXTRACT_RULES = (
    " Rules: NEVER invent locations, quantities, worker counts, "
    "percentages or names — copy them from the transcript only; "
    "unknown stays null or []. Pair each quantity with the material it "
    "belongs to (quantities precede their material: '30 bags cement'). "
    "Keep original wording for items. "
    "severity is High only for PPE violations, injuries or "
    "immediate danger, else Medium. summary is one short line.")

# Few-shot anchor: the exact failure class from production (unpunctuated
# dictation where one safety keyword must not swallow the whole update).
_EXTRACT_EXAMPLE = (
    ' Transcript: "Update from Green Valley Tower Floor 7 Finished plaster '
    'used 30 bags cement and 200 pieces tiles Tiles running low need more '
    'Two workers without helmets on Floor 7 Tomorrow will start '
    'waterproofing"'
    ' Expected JSON: {"progress": ["Finished plaster"], '
    '"materials": [{"name": "cement", "qty": 30, "unit": "bags"}, '
    '{"name": "tiles", "qty": 200, "unit": "pieces"}], '
    '"material_low": ["Tiles running low need more"], '
    '"safety": [{"title": "Two workers without helmets on Floor 7", '
    '"area": null, "severity": "High"}], '
    '"tomorrow": ["Tomorrow will start waterproofing"], "other": [], '
    '"locations": {"building": null, "floor": "7", "area": null}, '
    '"summary": "Finished plaster; helmets missing on Floor 7"}')


def _extract_system_prompt(extra: str = "") -> str:
    base = ("You extract structured daily site-update data from a spoken "
            "construction supervisor transcript. Return ONLY valid JSON, "
            "no markdown, matching this shape: " + _EXTRACT_SCHEMA_HINT +
            _EXTRACT_RULES + " Example: " + _EXTRACT_EXAMPLE)
    return base + (f" Repair instruction: {extra}" if extra else "")


def _openrouter_extract_raw(transcript: str, system_prompt: str):
    """One LLM call. Returns the raw parsed dict. Raises on transport or
    JSON errors; returns None only when no key is configured."""
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key:
        return None
    payload = json.dumps({
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": transcript},
        ],
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "HTTP-Referer": "http://localhost:5174",
                 "X-Title": "BuildSafe voice updates"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    content = data["choices"][0]["message"]["content"]
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("LLM reply contained no JSON object.")
    parsed = json.loads(content[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("LLM reply was not a JSON object.")
    return parsed


def _validate_extraction(parsed) -> list:
    """Server-side schema check. Returns a list of human-readable errors
    (empty = valid). The repair retry quotes these back to the model."""
    errors = []
    if not isinstance(parsed, dict):
        return ["top-level JSON is not an object"]
    for k in ("progress", "material_low", "tomorrow", "other"):
        v = parsed.get(k)
        if v is not None and not isinstance(v, list):
            errors.append(f'"{k}" must be a list')
        elif isinstance(v, list):
            for i, x in enumerate(v):
                if not isinstance(x, (str, int, float)):
                    errors.append(f'"{k}[{i}]" must be a string')
    mats = parsed.get("materials")
    if mats is not None:
        if not isinstance(mats, list):
            errors.append('"materials" must be a list')
        else:
            for i, m in enumerate(mats):
                if not isinstance(m, dict):
                    errors.append(f'"materials[{i}]" must be an object')
                    continue
                if not str(m.get("name") or "").strip():
                    errors.append(f'"materials[{i}].name" is required')
                qty = m.get("qty")
                if qty is not None:
                    try:
                        if float(qty) < 0:
                            errors.append(
                                f'"materials[{i}].qty" must not be negative')
                    except (TypeError, ValueError):
                        errors.append(
                            f'"materials[{i}].qty" must be a number or null')
    saf = parsed.get("safety")
    if saf is not None:
        if not isinstance(saf, list):
            errors.append('"safety" must be a list')
        else:
            for i, s in enumerate(saf):
                if not isinstance(s, dict):
                    errors.append(f'"safety[{i}]" must be an object')
                    continue
                if not str(s.get("title") or "").strip():
                    errors.append(f'"safety[{i}].title" is required')
                sev = s.get("severity")
                if sev is not None and str(sev).capitalize() not in (
                        "High", "Medium", "Low"):
                    errors.append(
                        f'"safety[{i}].severity" must be High/Medium/Low')
    loc = parsed.get("locations")
    if loc is not None and not isinstance(loc, dict):
        errors.append('"locations" must be an object')
    summ = parsed.get("summary")
    if summ is not None and not isinstance(summ, (str, int, float)):
        errors.append('"summary" must be a string')
    return errors


def _clean_extraction(parsed: dict) -> dict:
    """Sanitize a validated raw dict into the confirmed review shape."""
    clean = {"progress": [], "materials": [], "material_low": [],
             "safety": [], "tomorrow": [], "other": [],
             "locations": {"building": None, "floor": None, "area": None},
             "summary": ""}
    for k in ("progress", "material_low", "tomorrow", "other"):
        v = parsed.get(k)
        if isinstance(v, list):
            clean[k] = [str(x)[:200] for x in v if str(x).strip()][:20]
    mats = parsed.get("materials")
    if isinstance(mats, list):
        for m in mats:
            if not isinstance(m, dict):
                continue
            name = str(m.get("name") or "").strip()[:60]
            if not name:
                continue
            try:
                qty = m.get("qty")
                qty = float(qty) if qty is not None else None
                if qty is not None and float(qty).is_integer():
                    qty = int(qty)
            except (TypeError, ValueError):
                qty = None
            unit = m.get("unit")
            unit = str(unit)[:20] if unit else None
            clean["materials"].append({"name": name, "qty": qty, "unit": unit})
    saf = parsed.get("safety")
    if isinstance(saf, list):
        for s in saf:
            if not isinstance(s, dict):
                continue
            title = str(s.get("title") or "").strip()
            if not title:
                continue
            sev = str(s.get("severity") or "Medium").capitalize()
            if sev not in ("High", "Medium", "Low"):
                sev = "Medium"
            area = s.get("area")
            clean["safety"].append({
                "title": title[:200],
                "area": str(area)[:60] if area else None,
                "severity": sev})
    loc = parsed.get("locations")
    if isinstance(loc, dict):
        for k in ("building", "floor", "area"):
            if loc.get(k):
                clean["locations"][k] = str(loc[k])[:60]
    summ = parsed.get("summary")
    clean["summary"] = str(summ)[:200] if summ else ""
    return clean


def _openrouter_extract(transcript: str):
    """Legacy single-shot wrapper (kept for compatibility)."""
    raw = _openrouter_extract_raw(transcript, _extract_system_prompt())
    return _clean_extraction(raw) if raw else None


def _extract_voice_update(transcript: str):
    """Agentic loop: LLM extract -> validate -> one repair retry ->
    heuristic fallback. Returns (structured, engine, note) where note tells
    the review UI exactly which path ran and why, so degradation is loud."""
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key:
        return (_heuristic_extract(transcript), "heuristic",
                "No LLM key configured — on-device rules used.")
    try:
        raw = _openrouter_extract_raw(transcript, _extract_system_prompt())
    except Exception as e:
        print(f"[voice] LLM extraction failed ({e}) -> heuristic")
        return (_heuristic_extract(transcript), "heuristic",
                f"LLM unavailable ({e}) — on-device rules used.")
    errors = _validate_extraction(raw)
    if errors:
        try:
            raw = _openrouter_extract_raw(
                transcript,
                _extract_system_prompt(
                    "Your previous reply failed validation: "
                    + "; ".join(errors[:5]) +
                    ". Return corrected JSON only, same shape."))
        except Exception as e:
            print(f"[voice] LLM repair failed ({e}) -> heuristic")
            return (_heuristic_extract(transcript), "heuristic",
                    f"LLM repair failed ({e}) — on-device rules used.")
        errors = _validate_extraction(raw)
        if errors:
            print(f"[voice] LLM output invalid ({errors[0]}) -> heuristic")
            return (_heuristic_extract(transcript), "heuristic",
                    f"LLM output failed validation ({errors[0]}) — "
                    f"on-device rules used.")
        return (_clean_extraction(raw), "llm",
                "AI model (verified after one repair).")
    return (_clean_extraction(raw), "llm", "AI model (verified).")


@app.post("/api/voice-updates/extract")
def voice_extract(req: VoiceExtractRequest):
    transcript = (req.transcript or "").strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="Empty transcript.")
    if len(transcript) < 3:
        raise HTTPException(status_code=400,
                            detail="Recording too short to understand.")
    structured, engine, note = _extract_voice_update(transcript)
    return {"structured": structured, "engine": engine, "note": note,
            "llm_configured": bool(os.getenv("OPENROUTER_API_KEY", "").strip())}


def _voice_notes(req: VoiceSaveRequest, structured: dict, log_date: str) -> str:
    kind = "Typed" if (req.source or "voice").strip().lower() == "typed" else "Voice"
    bits = [f"{kind} daily update ({log_date})"]
    loc_bits = [p for p in (req.area, req.building, req.floor) if p]
    if loc_bits:
        bits.append("Location: " + ", ".join(loc_bits))
    if structured.get("summary"):
        bits.append("Summary: " + structured["summary"])
    if structured.get("progress"):
        bits.append("Progress: " + "; ".join(structured["progress"][:6]))
    if structured.get("materials"):
        bits.append("Materials: " + "; ".join(
            f"{m['name']}" + (f" {m['qty']} {m.get('unit') or ''}".rstrip()
                              if m.get("qty") is not None else "")
            for m in structured["materials"][:8]))
    if structured.get("material_low"):
        bits.append("Stock alerts: " + "; ".join(structured["material_low"][:4]))
    if structured.get("safety"):
        bits.append("Safety: " + "; ".join(
            s["title"] for s in structured["safety"][:6]))
    if structured.get("tomorrow"):
        bits.append("Tomorrow: " + "; ".join(structured["tomorrow"][:4]))
    if req.submitted_by:
        bits.append("Reported by: " + req.submitted_by)
    return "\n".join(bits)[:4000]


# ---------------- Phase 4: Daily Update fan-out ----------------
# After a user-CONFIRMED daily update is saved, it feeds:
#   Progress (projects.progress, explicit % only) → Inventory (materials
#   used_qty, exact-name + unit match only) → Safety Incident
#   (safety_issues) → Risk Engine (risks + alerts queue) → AI Chat (reads
#   all of the above + the update notes; no separate push needed).
# Anti-hallucination rule: anything ambiguous is SKIPPED with a reason that
# is stored on the notes and returned — never guessed.

def _norm_token(text) -> str:
    return (text or "").strip().lower().rstrip("s")


def _resolve_site_area(cursor, project_id, area_text, site_id=None):
    """Map free-text area to Phase-2 (site_id, area_id). Returns Nones when
    the text matches nothing or matches areas on several sites (ambiguous).
    Never invents a location."""
    if not (area_text or "").strip():
        return (site_id, None)
    norm = area_text.strip().lower()
    rows = cursor.execute(
        "SELECT areas.id, areas.site_id, areas.name FROM areas "
        "JOIN sites ON sites.id = areas.site_id "
        "WHERE sites.project_id = ?", (project_id,)).fetchall()
    if site_id is not None:
        rows = [r for r in rows if r["site_id"] == site_id]
    hits = [r for r in rows if (r["name"] or "").strip().lower() == norm]
    if len(hits) == 1:
        return (hits[0]["site_id"], hits[0]["id"])
    if site_id is not None or not hits:
        return (site_id, None)
    # Several sites have an area with this name and no site was pinned down.
    return (None, None)


def _match_project_material(cursor, project_id, name):
    """Returns (row, ambiguous). Exact-name match (plural-tolerant) within
    the project only. Zero or 2+ hits both mean: do not touch stock."""
    norm = _norm_token(name)
    if not norm:
        return (None, False)
    rows = cursor.execute(
        "SELECT * FROM materials WHERE project_id = ?", (project_id,)).fetchall()
    hits = [r for r in rows if _norm_token(r["name"]) == norm]
    if len(hits) == 1:
        return (hits[0], False)
    return (None, len(hits) > 1)


def _units_match(spoken, stocked) -> bool:
    if not spoken or not stocked:
        return False
    return _norm_token(spoken) == _norm_token(stocked)


def _add_alert(cursor, project_id, site_id, source, source_id, severity, title):
    cursor.execute(
        "INSERT INTO alerts (project_id, site_id, source, source_id, severity, "
        "title, status) VALUES (?, ?, ?, ?, ?, ?, 'open')",
        (project_id, site_id, source, source_id, severity,
         str(title or "")[:200]),
    )
    return cursor.lastrowid


def _create_pending_incident(cursor, project_id, area, kind, obs_id,
                             compliance, viol_count, engine_label):
    """Phase 10: a vision violation becomes a PENDING AI incident, never a
    verdict. A supervisor confirms or dismisses it; only then does it fully
    join the risk engine as ground truth. Always paired with an alert."""
    sev = ("High" if compliance is not None and compliance < 50
           else "Medium")
    title = (f"{viol_count} worker(s) without helmets — {area} "
             f"(pending AI review)")
    desc = (f"AI {kind} analysis #{obs_id} ({area}) found {viol_count} "
            f"unhelmeted sighting(s) at {compliance}% helmet compliance "
            f"(engine: {engine_label}). Review the annotated frames in "
            f"observation #{obs_id}, then confirm or dismiss — nothing here "
            f"is a verified violation yet.")
    cursor.execute(
        "INSERT INTO safety_issues (project_id, title, description, category, "
        "severity, reported_by, source, status, observation_id, confidence) "
        "VALUES (?, ?, ?, 'PPE', ?, 'SiteVision AI', 'vision-ai', 'pending', "
        "?, ?)",
        (project_id, title, desc, sev, obs_id, compliance),
    )
    iid = cursor.lastrowid
    aid = _add_alert(cursor, project_id, None, "vision", iid, sev, title)
    return (iid, aid)


@app.post("/api/voice-updates")
def voice_save(req: VoiceSaveRequest):
    from datetime import date as _date
    transcript = (req.transcript or "").strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="Empty transcript.")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id = ?",
                   (req.project_id,))
    proj = cursor.fetchone()
    if proj is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    structured = req.structured if isinstance(req.structured, dict) else None
    engine = "user-confirmed"
    if not structured:
        structured, engine, _note = _extract_voice_update(transcript)
    log_date = (req.log_date or "").strip() or _date.today().isoformat()
    area = (req.area or "").strip() or None
    building = (req.building or "").strip() or None
    floor = (req.floor or "").strip() or None
    source = (req.source or "voice").strip().lower()
    if source not in ("voice", "typed", "manual"):
        source = "voice"
    # Phase 4a: pin the update to the location hierarchy when the free-text
    # area names a modelled area (unambiguous only).
    site_id, area_id = _resolve_site_area(
        cursor, req.project_id, area, req.site_id)
    # Phase 4b: explicit progress only (typed form's number). Out-of-range
    # or missing values leave the project untouched.
    progress_pct = None
    try:
        if req.progress_pct is not None:
            v = float(req.progress_pct)
            if 0 <= v <= 100:
                progress_pct = v
    except (TypeError, ValueError):
        progress_pct = None
    progress_change = None
    if progress_pct is not None:
        old_prog = proj["progress"] if "progress" in proj.keys() else 0
        try:
            old_prog = float(old_prog or 0)
        except (TypeError, ValueError):
            old_prog = 0.0
        new_prog = (int(progress_pct)
                    if float(progress_pct).is_integer() else progress_pct)
        if old_prog != float(new_prog):
            cursor.execute("UPDATE projects SET progress = ? WHERE id = ?",
                           (new_prog, req.project_id))
            progress_change = {"from": old_prog, "to": new_prog}
    # Phase 4c: inventory — apply usage ONLY for exact-name + unit matches
    # with a positive qty. Name-only mentions ("cement stock is low") and
    # anything ambiguous never touch quantities; they become warnings below.
    inv_applied, inv_skipped = [], []
    mats = (structured.get("materials", [])
            if isinstance(structured, dict) else [])
    for m in mats:
        if not isinstance(m, dict):
            continue
        mname = str(m.get("name") or "").strip()
        qty, unit = m.get("qty"), (m.get("unit") or "").strip() or None
        if not mname or qty is None:
            continue
        try:
            q = float(qty)
        except (TypeError, ValueError):
            inv_skipped.append({"name": mname, "reason": "quantity unreadable"})
            continue
        if q <= 0:
            inv_skipped.append({"name": mname, "reason": "no positive quantity"})
            continue
        match, ambiguous = _match_project_material(
            cursor, req.project_id, mname)
        if ambiguous:
            inv_skipped.append({"name": mname,
                                "reason": "several inventory items share this name"})
            continue
        if match is None:
            inv_skipped.append({"name": mname,
                                "reason": "no such item in project inventory"})
            continue
        if unit and not _units_match(unit, match["unit"]):
            inv_skipped.append({"name": mname, "reason":
                                f"unit mismatch (stocked in {match['unit'] or 'units'})"})
            continue
        cursor.execute(
            "UPDATE materials SET used_qty = COALESCE(used_qty, 0) + ? WHERE id = ?",
            (q, match["id"]))
        inv_applied.append({"material_id": match["id"], "name": match["name"],
                            "added": q, "unit": match["unit"] or unit or "units"})
    safety = structured.get("safety", []) if isinstance(structured, dict) else []
    low = (structured.get("material_low", [])
           if isinstance(structured, dict) else [])
    status = "Attention" if (safety or low) else "On Track"
    notes = _voice_notes(req, structured if isinstance(structured, dict) else {},
                         log_date)
    if progress_change is not None:
        notes += (f"\nProgress updated: {progress_change['from']:g}% → "
                  f"{progress_change['to']}%")
    if inv_applied:
        notes += ("\nInventory applied: " + "; ".join(
            f"{a['name']} used +{a['added']:g} {a['unit']}" for a in inv_applied))
    if inv_skipped:
        notes += ("\nInventory left unchanged: " + "; ".join(
            f"{s['name']} ({s['reason']})" for s in inv_skipped[:6]))
    notes = notes[:4000]
    cursor.execute(
        "INSERT INTO inspections (project_id, status, notes, source, transcript, "
        "structured, area, log_date, site_id, building, floor) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (req.project_id, status, notes, source, transcript,
         json.dumps(structured), area, log_date, site_id,
         building, floor),
    )
    inspection_id = cursor.lastrowid
    safety_ids, risk_ids, alert_ids = [], [], []
    via = ("voice" if source == "voice" else "typed") + " daily update"
    for s in safety:
        title = str(s.get("title", ""))[:200] or "Safety issue from daily update"
        sev = s.get("severity", "Medium") or "Medium"
        desc = (f"Reported via {via} #{inspection_id} "
                f"({log_date})"
                + (f" in {s.get('area')}" if s.get("area") else "")
                + (f" — reported by {req.submitted_by}" if req.submitted_by else "")
                + f". Transcript excerpt: {transcript[:300]}")
        cat = ("PPE" if any(w in title.lower()
                             for w in ("helmet", "hard hat", "hardhat", "ppe",
                                       "vest", "harness", "gloves", "goggles"))
               else "Safety")
        cursor.execute(
            "INSERT INTO safety_issues (project_id, title, description, category, "
            "severity, reported_by, site_id, area_id, source, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, "
            "'daily-update', 'confirmed')",
            (req.project_id, title, desc, cat, sev,
             req.submitted_by, site_id, area_id),
        )
        sid = cursor.lastrowid
        safety_ids.append(sid)
        # Phase 4d: High-severity incidents also enter the Risk Engine.
        if sev == "High":
            cursor.execute(
                "INSERT INTO risks (project_id, title, description, category, "
                "severity, status, site_id) VALUES (?, ?, ?, 'Safety', 'High', "
                "'open', ?)",
                (req.project_id, f"High-severity incident: {title}",
                 f"Raised from {via} #{inspection_id} ({log_date}). "
                 f"See safety issue #{sid}.", site_id),
            )
            risk_ids.append(cursor.lastrowid)
            alert_ids.append(_add_alert(
                cursor, req.project_id, site_id, "safety", sid, "High", title))
    for line in low:
        cursor.execute(
            "INSERT INTO risks (project_id, title, description, category, "
            "severity, status, site_id) VALUES (?, ?, ?, 'Resource', 'Medium', "
            "'open', ?)",
             (req.project_id,
              f"Material shortage flagged in {via} #{inspection_id}",
              f"{line[:200]} (reported {log_date} via {via} "
              f"#{inspection_id}; verify stock before reordering).",
              site_id),
        )
        rid = cursor.lastrowid
        risk_ids.append(rid)
        alert_ids.append(_add_alert(
            cursor, req.project_id, site_id, "risk", rid, "Medium",
            f"Material shortage flagged in {via} #{inspection_id}"))
    conn.commit()
    conn.close()
    return {"inspection_id": inspection_id, "status": status,
            "safety_issue_ids": safety_ids, "risk_ids": risk_ids,
            "alert_ids": alert_ids, "engine": engine,
            "site_id": site_id, "area_id": area_id,
            "progress_updated": progress_change,
            "inventory_applied": inv_applied,
            "inventory_skipped": inv_skipped}


# ---------------- Offline speech-to-text (no key) ----------------
# faster-whisper runs fully on this server (CPU, int8): free, private, no
# API key. WHISPER_MODEL override: tiny < base (default) < small < medium.

_STT_MODEL = None
_STT_MODEL_NAME = None


def _local_stt_model():
    """Lazily load the offline Whisper model (downloads weights once)."""
    global _STT_MODEL, _STT_MODEL_NAME
    name = os.getenv("WHISPER_MODEL", "base").strip() or "base"
    if _STT_MODEL is None or _STT_MODEL_NAME != name:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise HTTPException(
                status_code=501,
                detail="Offline transcription is not installed here "
                       "(pip install faster-whisper) and no OPENAI_API_KEY is "
                       "set. Use Chrome/Edge live transcription or type the "
                       "update manually.")
        _STT_MODEL = WhisperModel(name, device="cpu", compute_type="int8")
        _STT_MODEL_NAME = name
    return _STT_MODEL


def _transcribe_offline(blob: bytes, filename: str) -> str:
    import tempfile
    suffix = os.path.splitext(filename or "")[1] or ".webm"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(blob)
        tmp.close()
        model = _local_stt_model()
        segments, _info = model.transcribe(tmp.name, language="en",
                                           beam_size=5)
        return " ".join(s.text.strip() for s in segments).strip()
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@app.post("/api/stt/transcribe")
async def stt_transcribe(audio: UploadFile = File(...)):
    """Server-side speech-to-text. The primary path is the browser Web
    Speech API (no key needed); this is the fallback for browsers without
    it. With OPENAI_API_KEY set it uses the Whisper API, otherwise the
    offline faster-whisper model on this server — also no key."""
    import io
    blob = await audio.read()
    if not blob:
        raise HTTPException(status_code=400, detail="Empty audio file.")
    if len(blob) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400,
                            detail="Audio too large (max 25 MB).")
    filename = (audio.filename or "update.webm").replace('"', "")
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        try:
            text = _transcribe_offline(blob, filename)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502,
                                detail=f"Offline transcription failed: {e}")
        if not text:
            raise HTTPException(status_code=502,
                                detail="Transcription heard no speech.")
        return {"transcript": text, "engine": "whisper-offline"}
    boundary = secrets.token_hex(16)
    ctype = audio.content_type or "audio/webm"
    body = io.BytesIO()
    body.write(
        f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n'
        f"\r\nwhisper-1\r\n".encode()
    )
    body.write(f'--{boundary}\r\nContent-Disposition: form-data; '
               f'name="file"; filename="{filename}"\r\n'
               f"Content-Type: {ctype}\r\n\r\n".encode())
    body.write(blob)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        "https://api.openai.com/v1/audio/transcriptions",
        data=body.getvalue(),
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        raise HTTPException(status_code=502,
                            detail=f"Transcription service failed: {e}")
    text = (data.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=502,
                            detail="Transcription returned no speech.")
    return {"transcript": text, "engine": "whisper-api"}


# ---------------- Observations (video/photo analysis results) ----------------

@app.get("/api/observations")
def list_observations(project_id: int | None = None):
    conn = get_db()
    cursor = conn.cursor()
    if project_id:
        cursor.execute(
            "SELECT * FROM observations WHERE project_id = ? ORDER BY id DESC",
            (project_id,),
        )
    else:
        cursor.execute("SELECT * FROM observations ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["details"] = json.loads(d["details"]) if d["details"] else {}
        except Exception:
            pass
        out.append(d)
    return out


# ---------------- Dashboard summary ----------------

@app.get("/api/dashboard/summary")
def dashboard_summary():
    conn = get_db()
    cursor = conn.cursor()
    projects = cursor.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
    inspections = cursor.execute("SELECT COUNT(*) FROM inspections").fetchone()[0]
    pending = cursor.execute(
        "SELECT COUNT(*) FROM inspections WHERE LOWER(status) IN ('pending','attention','delayed','fail','failed')"
    ).fetchone()[0]
    # Open safety incidents live in safety_issues (AI pending review included),
    # not inspections — the top card must count both or it reads 0 while
    # Priority Alerts below correctly shows open issues.
    try:
        safety_open = cursor.execute(
            "SELECT COUNT(*) FROM safety_issues WHERE resolved_at IS NULL"
        ).fetchone()[0]
    except Exception:
        safety_open = 0
    materials = cursor.execute("SELECT COUNT(*) FROM materials").fetchone()[0]
    observations = cursor.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
    latest = cursor.execute(
        "SELECT * FROM observations ORDER BY id DESC LIMIT 1"
    ).fetchone()
    total_budget = cursor.execute(
        "SELECT COALESCE(SUM(COALESCE(total_budget, 0)), 0) FROM projects"
    ).fetchone()[0]
    total_spent = cursor.execute(
        "SELECT COALESCE(SUM(COALESCE(cost, 0) * COALESCE(used_qty, 0)), 0) "
        "FROM materials"
    ).fetchone()[0]
    # Budget-at-risk: predicted is not None and overrun_pct > 10 (computed in Python).
    budget_at_risk_count = 0
    for p in cursor.execute("SELECT * FROM projects").fetchall():
        spent = _actual_spent(cursor, p["id"])
        calc = _calc_budget(_col(p, "total_budget", 0), spent, _col(p, "progress", 0))
        if calc["predicted"] is not None and (calc["overrun_pct"] or 0) > 10:
            budget_at_risk_count += 1
    conn.close()
    return {
        "projects_total": projects,
        "inspections_total": inspections,
        "inspections_attention": pending + int(safety_open or 0),
        "inspections_flagged": pending,
        "safety_open": int(safety_open or 0),
        "materials_total": materials,
        "observations_total": observations,
        "latest_observation": dict(latest) if latest else None,
        "total_budget": total_budget,
        "total_spent": total_spent,
        "budget_at_risk_count": budget_at_risk_count,
    }


# ---------------- Search across stored records ----------------

@app.get("/api/search")
def search(q: str = "", area: str = ""):
    like = f"%{q}%"
    area_like = f"%{area}%" if area else "%"
    conn = get_db()
    cursor = conn.cursor()
    inspections = cursor.execute(
        "SELECT * FROM inspections WHERE (notes LIKE ? OR status LIKE ?) "
        "ORDER BY id DESC LIMIT 20",
        (like, like),
    ).fetchall()
    materials = cursor.execute(
        "SELECT * FROM materials WHERE (name LIKE ? OR category LIKE ?) "
        "ORDER BY name LIMIT 20",
        (like, like),
    ).fetchall()
    observations = cursor.execute(
        "SELECT * FROM observations WHERE (title LIKE ? OR details LIKE ?) "
        "AND area LIKE ? ORDER BY id DESC LIMIT 20",
        (like, like, area_like),
    ).fetchall()
    projects = cursor.execute(
        "SELECT * FROM projects WHERE (name LIKE ? OR description LIKE ?) "
        "ORDER BY id DESC LIMIT 20",
        (like, like),
    ).fetchall()
    conn.close()
    return {
        "query": q,
        "projects": [dict(r) for r in projects],
        "inspections": [dict(r) for r in inspections],
        "materials": [dict(r) for r in materials],
        "observations": [dict(r) for r in observations],
    }


# ---------------- Video analysis ----------------

def _vision(name):
    """Import a symbol from vision / vision_yolo regardless of launch mode.

    Works for both documented launches:
      * project root:  python -m uvicorn backend.main:app  (package mode)
      * legacy bat:    uvicorn main:app --app-dir backend   (top-level mode)
    Raises 503 with an ACCURATE cause: missing cv2 vs missing module.
    """
    import importlib

    mod_name, attr = name.rsplit(".", 1)
    errors = []
    for fullname in (f"backend.{mod_name}", mod_name):
        try:
            return getattr(importlib.import_module(fullname), attr)
        except (ImportError, AttributeError) as e:
            errors.append(f"{fullname}: {e}")
    try:
        import cv2  # noqa: F401
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Video analysis engine (opencv) is not installed. "
                   "Run: pip install -r backend/requirements.txt",
        )
    raise HTTPException(
        status_code=503,
        detail=f"Vision module '{mod_name}' could not be imported "
               f"({errors[-1]}). "
               f"Launch from the project root: python -m uvicorn backend.main:app",
    )


def _run_video_analysis(tmp_path, out_dir, url_prefix):
    """YOLO-first with fail-safe legacy fallback.

    Safety rule: the returned dict always carries engine/model/degraded so
    the frontend can never mistake a degraded HSV pass for a YOLO verdict.
    """
    try:
        yolo_video = _vision("vision_yolo.analyze_video")
        is_yolo_available = _vision("vision_yolo.is_yolo_available")
    except HTTPException:
        yolo_video = None
        is_yolo_available = lambda: False  # noqa: E731
    if yolo_video is not None:
        try:
            if is_yolo_available():
                r = yolo_video(tmp_path, out_dir=out_dir, url_prefix=url_prefix)
                r["engine"] = "yolo"
                return r
            print("[vision] ultralytics weights unavailable -> legacy fallback")
        except RuntimeError as e:
            print(f"[vision] YOLO unavailable ({e}) -> legacy fallback")
        except ValueError:
            raise
        except Exception as e:
            print(f"[vision] YOLO pass failed ({e}) -> legacy fallback")
    analyze_video = _vision("vision.analyze_video")
    r = analyze_video(tmp_path, out_dir=out_dir, url_prefix=url_prefix)
    r["engine"] = "legacy"
    r["model"] = r.get("model", "hog-cascade-legacy")
    r["degraded"] = True
    return r


def _legacy_photo_analysis(image_bgr, out_path):
    """Single-frame fused fallback so /analyze-image works with no weights.

    HOG-alone misses close-up/truncated workers and distant crews, so this
    runs the fused proposer set (dense HOG + native-res tiles +
    face-derived boxes, IoU-deduped) — the fused count is monotonic,
    never below HOG-alone. Verdicts stay HSV/fail-safe as before.
    """
    import cv2

    try:
        detect_fused = _vision("vision.detect_people_fused")
        merged, fusion = detect_fused(image_bgr, sensitive=True)
        persons = [b for b, _ in merged]
        sources = [s for _, s in merged]
        fusion = dict(fusion)
    except Exception as e:
        print(f"[vision] fused proposers failed ({e}) -> HOG-only")
        detect_people_hog = _vision("vision.detect_people_hog")
        persons = detect_people_hog(image_bgr)
        sources = ["hog"] * len(persons)
        fusion = {"hog": len(persons)}
    helmet_state = _vision("vision.helmet_state")
    verdicts = []
    for b, src in zip(persons, sources):
        verdicts.append(helmet_state(image_bgr, b))
    colors = {"helmet": (0, 200, 0), "no_helmet": (0, 0, 255), "unclear": (0, 215, 255)}
    for (x, y, w, h), v in zip(persons, verdicts):
        c = colors.get(v, (0, 215, 255))
        cv2.rectangle(image_bgr, (x, y), (x + w, y + h), c, 2)
        cv2.putText(image_bgr, v.replace("_", " "), (x, max(0, y - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, c, 2)
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        cv2.imwrite(out_path, image_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    n_h = verdicts.count("helmet")
    n_no = verdicts.count("no_helmet")
    n_un = verdicts.count("unclear")
    judged = n_h + n_no
    extra = sum(v for k, v in fusion.items() if k != "hog")
    return {
        "workers": len(persons), "helmets": n_h, "no_helmet": n_no, "unclear": n_un,
        "needs_review": n_un,
        "compliance_pct": round(100.0 * n_h / judged, 1) if judged else None,
        "boxes": [{"box": list(map(int, b)), "verdict": v, "conf": 0.0,
                   "needs_review": v == "unclear", "source": s}
                  for b, v, s in zip(persons, verdicts, sources)],
        "model": "hog-cascade-legacy", "device": "cpu",
        "degraded": True, "interim_hsv_helmet": True,
        "fusion": fusion, "extra_sightings": extra,
    }


@app.post("/api/vision/analyze-video")
async def analyze_video_endpoint(
    video: UploadFile = File(...),
    project_id: int = Form(1),
    area: str = Form("Site"),
):
    name = (video.filename or "").lower()
    if not (name.endswith((".mp4", ".mov", ".avi", ".mkv", ".webm"))
            or (video.content_type or "").startswith("video/")):
        raise HTTPException(status_code=400, detail="Please upload a video file.")
    obs_id = None
    suffix = os.path.splitext(name)[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        size = 0
        while True:
            chunk = await video.read(4 * 1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > 150 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="Video too large (max 150MB).")
            tmp.write(chunk)
        tmp.close()
        if size == 0:
            raise HTTPException(
                status_code=400,
                detail="Uploaded video is empty (0 bytes). Pick the clip again and retry.")
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO observations (project_id, area, kind, title, details) "
            "VALUES (?, ?, 'video', ?, ?)",
            (project_id, area, f"Video analysis: {video.filename}", "{}"),
        )
        obs_id = cursor.lastrowid
        conn.commit()
        conn.close()
        out_dir = os.path.join(FRAMES_ROOT, str(obs_id))
        result = _run_video_analysis(
            tmp.name, out_dir=out_dir, url_prefix=f"/static/frames/{obs_id}"
        )
        title = (f"Video: avg {result['avg_workers']} workers, "
                 f"activity {result['activity_score']}/100")
        if result["helmet_compliance_pct"] is not None:
            title += f", helmets {result['helmet_compliance_pct']}%"
        conn = get_db()
        conn.execute(
            "UPDATE observations SET title = ?, details = ? WHERE id = ?",
            (title, json.dumps(result), obs_id),
        )
        conn.commit()
        conn.close()
        # Phase 10: low helmet compliance becomes a PENDING AI incident
        # (human must confirm), not a verdict and not a duplicate
        # inspection. It joins the risk engine via the incident register.
        viol_count = int(result.get("no_helmet_detected") or 0)
        safety_flag = (
            result["helmet_compliance_pct"] is not None
            and result["helmet_compliance_pct"] < 80
            and viol_count > 0
        )
        incident_id, alert_id = None, None
        if safety_flag:
            conn = get_db()
            cur = conn.cursor()
            incident_id, alert_id = _create_pending_incident(
                cur, project_id, area, "video", obs_id,
                result["helmet_compliance_pct"], viol_count,
                result.get("engine", "vision") or "vision")
            conn.commit()
            conn.close()
        return {"observation_id": obs_id, "safety_flag": safety_flag,
                "inspection_id": None, "incident_id": incident_id,
                "alert_id": alert_id, **result}
    except HTTPException:
        raise
    except ValueError as e:
        conn = get_db()
        conn.execute("UPDATE observations SET title = ? WHERE id = ?",
                     (f"Video analysis failed: {e}", obs_id))
        conn.commit()
        conn.close()
        raise HTTPException(
            status_code=400,
            detail=f"{e} If the clip came from a phone, re-export or share it "
                   f"as MP4 (H.264) — HEVC/MOV variants often fail to decode "
                   f"on the server.")
    except Exception as e:
        conn = get_db()
        conn.execute("UPDATE observations SET title = ? WHERE id = ?",
                     ("Video analysis failed during processing", obs_id))
        conn.commit()
        conn.close()
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@app.post("/api/vision/analyze-image")
async def analyze_image_endpoint(
    image: UploadFile = File(...),
    project_id: int = Form(1),
    area: str = Form("Site"),
    photo_taken_at: str | None = Form(default=None),
    photo_lat: float | None = Form(default=None),
    photo_lon: float | None = Form(default=None),
    provenance_source: str | None = Form(default=None),
    device_coords: str | None = Form(default=None),
):
    """Real photo inference — replaces the mocked frontend demo results.

    Accepts JPG/PNG/WEBP, runs YOLOv8-PPE (or legacy fallback), saves an
    annotated frame under /static/frames/<obs_id>/ and stores the result as
    an observation (kind='photo') so history, search and GenAI all see it.

    Provenance (all optional, frontend-extracted): photo_taken_at (ISO),
    photo_lat/photo_lon (EXIF GPS when present), provenance_source
    ('exif' | 'device'), device_coords (uploader GPS at upload time).
    Stored verbatim in the observation details so the photo register can
    show EXIF-grade vs device-grade evidence honestly.
    """
    import cv2
    import numpy as np

    name = (image.filename or "").lower()
    ctype = (image.content_type or "").lower()
    if not (name.endswith((".jpg", ".jpeg", ".png", ".webp"))
            or ctype.startswith("image/")):
        raise HTTPException(status_code=400, detail="Please upload an image file.")
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 15MB).")
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image file.")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO observations (project_id, area, kind, title, details) "
        "VALUES (?, ?, 'photo', ?, ?)",
        (project_id, area, f"Photo analysis: {image.filename}", "{}"),
    )
    obs_id = cursor.lastrowid
    conn.commit()
    conn.close()
    out_dir = os.path.join(FRAMES_ROOT, str(obs_id))
    os.makedirs(out_dir, exist_ok=True)
    # Keep the untouched original next to the annotated copy: the site
    # photo register shows clean evidence; the annotated copy shows verdicts.
    oname = "original.jpg"
    with open(os.path.join(out_dir, oname), "wb") as f:
        f.write(data)
    original_url = f"/static/frames/{obs_id}/{oname}"
    fname = "annotated.jpg"
    out_path = os.path.join(out_dir, fname)
    url = f"/static/frames/{obs_id}/{fname}"
    try:
        try:
            yolo_image = _vision("vision_yolo.analyze_image")
            is_yolo_available = _vision("vision_yolo.is_yolo_available")
        except HTTPException:
            yolo_image = None
            is_yolo_available = lambda: False  # noqa: E731
        if yolo_image is not None and is_yolo_available():
            try:
                result = yolo_image(img, out_path=out_path, url=url)
                result["engine"] = "yolo"
            except RuntimeError as e:
                print(f"[vision] YOLO image unavailable ({e}) -> legacy fallback")
                result = _legacy_photo_analysis(img, out_path)
                result["annotated_url"] = url
                result["engine"] = "legacy"
        else:
            result = _legacy_photo_analysis(img, out_path)
            result["annotated_url"] = url
            result["engine"] = "legacy"
    except HTTPException:
        raise
    except Exception as e:
        conn = get_db()
        conn.execute("UPDATE observations SET title = ? WHERE id = ?",
                     ("Photo analysis failed during processing", obs_id))
        conn.commit()
        conn.close()
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")
    comp = result.get("compliance_pct")
    result["original_url"] = original_url
    # Photo provenance: EXIF-grade when the file carried it, else the
    # uploader's device GPS at upload time (labelled, never overstated).
    result["photo_taken_at"] = photo_taken_at
    result["photo_lat"] = photo_lat
    result["photo_lon"] = photo_lon
    result["provenance_source"] = provenance_source or ("exif" if photo_lat is not None or photo_taken_at else "device")
    result["device_coords"] = device_coords
    result["zone"] = area
    title = f"Photo: {result.get('workers', 0)} worker(s)"
    if comp is not None:
        title += f", helmets {comp}%"
    if result.get("degraded"):
        title += " (provisional — model degraded, needs review)"
    conn = get_db()
    conn.execute("UPDATE observations SET title = ?, details = ? WHERE id = ?",
                 (title, json.dumps(result), obs_id))
    conn.commit()
    conn.close()
    safety_flag = (comp is not None and comp < 80
                   and int(result.get("no_helmet", 0) or 0) > 0)
    incident_id, alert_id = None, None
    if safety_flag:
        conn = get_db()
        cur = conn.cursor()
        incident_id, alert_id = _create_pending_incident(
            cur, project_id, area, "photo", obs_id, comp,
            int(result.get("no_helmet", 0) or 0),
            result.get("engine", "vision") or "vision")
        conn.commit()
        conn.close()
    return {"observation_id": obs_id, "safety_flag": safety_flag,
            "inspection_id": None, "incident_id": incident_id,
            "alert_id": alert_id, **result}


# ---------------- Vision engine status (no weight loading) ----------------

@app.get("/api/vision/model-status")
def vision_model_status():
    """Lightweight engine health check for the SiteVision UI.

    Never loads model weights (that happens lazily on first analysis),
    so this is safe to call on every page view. Lets supervisors see
    BEFORE trusting a verdict whether the full YOLO engine or the
    degraded HOG+HSV fallback will run.
    """
    try:
        yolo_installed = _vision("vision_yolo.is_yolo_available")()
    except HTTPException:
        yolo_installed = False
    try:
        hog_ok = _vision("vision.hog_available")()
    except HTTPException:
        hog_ok = False
    if yolo_installed:
        engine = "yolo"
        note = "YOLO package installed — PPE weights load on first analysis."
    elif hog_ok:
        engine = "legacy"
        note = ("Degraded path only (HOG+HSV fallback) — verdicts are "
                "provisional and need human review.")
    else:
        engine = "unavailable"
        note = "No vision engine available — install backend requirements."
    return {
        "engine": engine,
        "yolo_installed": yolo_installed,
        "hog_available": hog_ok,
        "note": note,
    }


# ---------------- GenAI assistant (OpenRouter + grounded fallback) ----------------

def _status_counts():
    conn = get_db()
    rows = conn.cursor().execute(
        "SELECT COALESCE(status, 'Active') s, COUNT(*) c FROM projects GROUP BY s"
    ).fetchall()
    conn.close()
    return {r["s"]: r["c"] for r in rows}


def _shortfalls(project_id: int | None = None):
    conn = get_db()
    cursor = conn.cursor()
    if project_id:
        rows = cursor.execute(
            "SELECT * FROM materials WHERE project_id = ? ORDER BY name",
            (project_id,)).fetchall()
    else:
        rows = cursor.execute("SELECT * FROM materials ORDER BY name").fetchall()
    conn.close()
    out = []
    for m in rows:
        req = m["required_qty"] or 0
        rec = m["received_qty"] or 0
        used = m["used_qty"] or 0
        if req > 0 and rec < req:
            out.append(
                f"{m['name']} (project {m['project_id'] or '—'}): required {req:g}, "
                f"received {rec:g} — SHORT by {req - rec:g} {m['unit'] or 'units'}")
        elif req > 0:
            out.append(
                f"{m['name']} (project {m['project_id'] or '—'}): {rec:g}/{req:g} "
                f"{m['unit'] or 'units'} received, {used:g} used — OK")
    return out


def _budget_line(cursor, p):
    """One-line budget summary for GenAI grounding (all money in INR)."""
    spent = _actual_spent(cursor, p["id"])
    calc = _calc_budget(_col(p, "total_budget", 0), spent, _col(p, "progress", 0))
    prog = calc["progress"]
    try:
        top = _spend_drivers(cursor, p["id"], spent)[:2]
        drv = ("; top spend: " + ", ".join(
            f"{d['name']} {_inr_compact(d['spend'])} ({d['share_pct']}%)"
            for d in top)) if top else ""
    except Exception:
        drv = ""
    if calc["predicted"] is None:
        return (f"#{p['id']} {p['name']}: budget {_inr(calc['total_budget'])}, "
                f"spent {_inr(spent)}, progress {prog:g}% — "
                f"no forecast yet ({calc['note']}){drv}")
    return (f"#{p['id']} {p['name']}: budget {_inr(calc['total_budget'])}, "
            f"spent {_inr(spent)}, progress {prog:g}%, "
            f"predicted {_inr_compact(calc['predicted'])} vs budget {_inr_compact(calc['total_budget'])} "
            f"(overrun {_inr_compact(calc['overrun'])} / {calc['overrun_pct']:.1f}%), "
            f"risk {calc['risk']}{drv}")


# ---------------- Weekly report (Phase 12) ----------------
# One call gathers the week across every engine (updates, safety,
# recurrence, inventory, budget, schedule, risks, alerts) into a single
# report and snapshots it. Progress deltas compare against the previous
# snapshot — never against an invented baseline.

def _weekly_report_data(project_id: int, days: int = 7,
                        save: bool = True) -> dict:
    from datetime import date as _date, timedelta as _td
    try:
        days = max(2, min(31, int(days)))
    except (TypeError, ValueError):
        days = 7
    today = _date.today()
    start = today - _td(days=days - 1)
    conn = get_db()
    cursor = conn.cursor()
    proj = cursor.execute("SELECT * FROM projects WHERE id = ?",
                          (project_id,)).fetchone()
    if proj is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    progress = _col(proj, "progress", 0)

    def in_window(datestr) -> bool:
        try:
            d = _date.fromisoformat(str(datestr)[:10])
            return start <= d <= today
        except (TypeError, ValueError):
            return False

    updates = [r for r in cursor.execute(
        "SELECT * FROM inspections WHERE project_id = ?",
        (project_id,)).fetchall()
        if in_window(r["log_date"] if "log_date" in r.keys() else None)]
    by_status, by_source = {}, {}
    for r in updates:
        by_status[r["status"] or "?"] = by_status.get(r["status"] or "?", 0) + 1
        src = (r["source"] if "source" in r.keys() else None) or "manual"
        by_source[src] = by_source.get(src, 0) + 1

    sincs = cursor.execute("SELECT * FROM safety_issues WHERE project_id = ?",
                           (project_id,)).fetchall()
    in_week = [r for r in sincs
               if in_window(r["reported_at"] if "reported_at" in r.keys()
                            else None)]
    sev = {}
    for r in in_week:
        sev[r["severity"] or "Medium"] = sev.get(r["severity"] or "Medium", 0) + 1
    open_total = sum(
        1 for r in sincs
        if not (r["resolved_at"] if "resolved_at" in r.keys() else None))

    new_risks = [r for r in cursor.execute(
        "SELECT * FROM risks WHERE project_id = ?", (project_id,)).fetchall()
        if in_window(r["detected_at"] if "detected_at" in r.keys() else None)]
    open_risks = cursor.execute(
        "SELECT COUNT(*) FROM risks WHERE project_id = ? "
        "AND COALESCE(status, 'open') = 'open'", (project_id,)).fetchone()[0]
    alerts_open = cursor.execute(
        "SELECT source, COUNT(*) c FROM alerts WHERE project_id = ? "
        "AND COALESCE(status, 'open') = 'open' GROUP BY source",
        (project_id,)).fetchall()

    try:
        recur = _recurring_groups(project_id, 14, 3)
    except Exception:
        recur = []
    try:
        fc = _forecast_report(project_id, 14)
    except Exception:
        fc = {"materials": [], "shortage_count": 0}
    short_items = [m for m in fc["materials"] if m["predicted_shortage"]]
    try:
        bi = _budget_intel_data(project_id)
    except Exception:
        bi = None
    try:
        rep = _risk_scores(project_id)
    except Exception:
        rep = None
    try:
        prog = _tool_project_progress(project_id)
    except Exception:
        prog = {"days_since_last_update": None}

    prior, delta = None, None
    prior_row = cursor.execute(
        "SELECT payload FROM weekly_reports WHERE project_id = ? "
        "ORDER BY id DESC LIMIT 1", (project_id,)).fetchone()
    if prior_row:
        try:
            prior = json.loads(prior_row["payload"])
            delta = float(progress) - float(
                prior.get("progress", {}).get("current", progress))
        except Exception:
            prior, delta = None, None

    top_risks = []
    if rep:
        top_risks += rep["top_reasons"][:2]
    top_risks += [g["message"] for g in recur[:1]]
    top_risks = top_risks[:3]

    actions = []
    if sev.get("High", 0):
        actions.append(
            f"Resolve {sev['High']} HIGH incident(s) reported this week "
            f"before resuming normal work.")
    for m in short_items[:2]:
        actions.append(
            f"Order {m['name']}: {m['upcoming_requirement']:g} {m['unit']} "
            f"still needed ({m['reason']}).")
    for g in recur[:2]:
        actions.append(
            f"Investigate '{g['exemplar']}' in {g['location']} — "
            f"{g['occurrences']}× in 14 days.")
    if bi and (bi["overrun"] or 0) > 0:
        actions.append(
            f"Review burn: forecast {_inr_compact(bi['predicted_final'])} vs "
            f"{_inr_compact(bi['original_budget'])} budget.")
    stale = prog.get("days_since_last_update")
    if stale is not None and stale >= 3:
        actions.append(f"Site reporting is {stale} day(s) stale — request a "
                       f"supervisor update.")
    if not actions:
        actions.append("No action required — week is clear.")
    actions = actions[:5]

    report = {
        "project_id": project_id, "project_name": proj["name"],
        "week_start": start.isoformat(), "week_end": today.isoformat(),
        "days": days, "report_id": None,
        "progress": {"current": progress, "delta_vs_last_report": delta,
                     "updates_in_week": len(updates)},
        "daily_updates": {"count": len(updates), "by_status": by_status,
                          "by_source": by_source},
        "safety": {"reported_in_week": len(in_week), "by_severity": sev,
                   "open_total": open_total},
        "recurring": [{"message": g["message"],
                       "occurrences": g["occurrences"],
                       "location": g["location"]} for g in recur[:5]],
        "inventory": {"warnings": len(short_items),
                      "items": [{"name": m["name"], "stock": m["stock"],
                                 "unit": m["unit"],
                                 "days_remaining": m["days_remaining"],
                                 "reason": m["reason"]}
                                for m in short_items[:5]]},
        "budget": ({"original": bi["original_budget"], "spent": bi["spent"],
                    "predicted": bi["predicted_final"],
                    "overrun": bi["overrun"],
                    "overrun_pct": bi["overrun_pct"], "risk": bi["risk"],
                    "formatted": bi["formatted"]} if bi else None),
        "schedule": ({"score": rep["scores"]["schedule"],
                      "band": rep["bands"]["schedule"],
                      "delay_signals": bi["delay_signals"][:3] if bi else [],
                      "days_since_last_update": stale} if rep else None),
        "risks": {"raised_in_week": len(new_risks), "open_total": open_risks},
        "alerts_open": {r["source"]: r["c"] for r in alerts_open},
        "top_risks": top_risks,
        "recommended_actions": actions,
    }
    if save:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO weekly_reports (project_id, week_start, payload) "
            "VALUES (?, ?, ?)",
            (project_id, start.isoformat(), json.dumps(report)))
        report["report_id"] = cur.lastrowid
        conn.commit()
    conn.close()
    return report


@app.post("/api/reports/weekly")
def generate_weekly_report(project_id: int, days: int = 7):
    """Generate this week's report across all engines and snapshot it."""
    return _weekly_report_data(project_id, days, save=True)


@app.get("/api/reports/weekly")
def list_weekly_reports(project_id: int):
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute(
        "SELECT id, week_start, created_at, payload FROM weekly_reports "
        "WHERE project_id = ? ORDER BY id DESC LIMIT 12",
        (project_id,)).fetchall()
    conn.close()
    out = []
    for r in rows:
        try:
            payload = json.loads(r["payload"])
        except Exception:
            payload = {}
        out.append({"id": r["id"], "week_start": r["week_start"],
                    "created_at": r["created_at"], "payload": payload})
    return out


# ---------------- Natural-language search (Phase 14) ----------------
# "Show safety issues from the last 2 weeks" = parse the time window +
# place, then run the SAME agent tools with that window. No separate
# retrieval stack; the answer cites tool outputs only.

class NLSearchRequest(BaseModel):
    query_text: str
    project_id: int | None = None
    days: int | None = None  # explicit override (window chips in the UI)


def _parse_window(question: str):
    """Return (days, label) from prose like 'last 2 weeks' / 'yesterday'.
    None when the question carries no time constraint."""
    import re
    from datetime import date as _date, timedelta as _td
    q = (question or "").lower()
    m = re.search(r"last\s+(\d+)\s*(day|week|month|hour)", q)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        days = n * (7 if unit == "week" else 30 if unit == "month" else 1)
        days = max(1, min(90, days))
        end = _date.today()
        return {"days": days, "start": (end - _td(days=days - 1)).isoformat(),
                "end": end.isoformat(),
                "label": f"last {n} {unit}{'s' if n != 1 else ''}"}
    if "yesterday" in q:
        d = (_date.today() - _td(days=1)).isoformat()
        return {"days": 1, "start": d, "end": d, "label": "yesterday"}
    if "today" in q or "last 24 hours" in q or "past day" in q:
        d = _date.today().isoformat()
        return {"days": 1, "start": d, "end": d, "label": "today"}
    if "this week" in q:
        return _parse_window("last 7 days")
    if "this month" in q:
        return _parse_window("last 30 days")
    return None


def _in_search_window(datestr, window) -> bool:
    if window is None:
        return True
    from datetime import date as _date
    try:
        d = _date.fromisoformat(str(datestr)[:10]).isoformat()
        return window["start"] <= d <= window["end"]
    except (TypeError, ValueError):
        return False


@app.post("/api/search/nl")
def nl_search(req: NLSearchRequest):
    question = (req.query_text or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Empty query.")
    window = _parse_window(question)
    if req.days:
        try:
            days = max(1, min(90, int(req.days)))
        except (TypeError, ValueError):
            days = None
        if days:
            from datetime import date as _date, timedelta as _td
            end = _date.today()
            window = {"days": days,
                      "start": (end - _td(days=days - 1)).isoformat(),
                      "end": end.isoformat(), "label": f"last {days} days"}
    picks = _pick_tools(question, req.project_id)
    if window:
        picks = [(n, ({**a, "days": window["days"]}
                      if n in ("get_recent_incidents", "get_recurring_issues",
                               "get_weekly_report") else a))
                 for n, a in picks]
    used, sections = [], []
    for name, args in picks:
        try:
            out = _call_tool(name, args, req.project_id)
            used.append(name)
            if name == "get_area_issues" and window:
                sections.append(_render_area_window(out, window))
            elif name == "get_project_progress" and window:
                kept = [u for u in out.get("recent_updates", [])
                        if _in_search_window(u.get("log_date"), window)]
                out["recent_updates"] = kept
                if not kept:
                    out["note"] = ("No updates recorded "
                                   f"{window['label']}.")
                sections.append(_render_tool_section(name, out))
            else:
                sections.append(_render_tool_section(name, out))
        except Exception as e:
            sections.append(f"{name}:\nCould not load ({e}).")
    if not sections:
        sections.append("Try naming a project, area, time window "
                        "(e.g. 'last 2 weeks'), or a topic: safety, "
                        "inventory, budget, risk, recurrence.")
    head = (f"Results for “{window['label']}” "
            f"({window['start']} → {window['end']})" if window
            else "Results across all recorded time")
    return {"query": question, "project_id": req.project_id,
            "window": window, "tools_used": used,
            "answer": head + "\n\n" + "\n\n".join(sections)}


def _render_area_window(out: dict, window: dict) -> str:
    """Area matches with incidents/updates/observations cut to the window."""
    lines = []
    for m in out["matches"]:
        d = m.get("detail", {})
        inc = [i for i in d.get("incidents", [])
               if _in_search_window(i.get("reported_at"), window)]
        upd = [u for u in d.get("updates", [])
               if _in_search_window(u.get("log_date"), window)]
        obs = [o for o in d.get("observations", [])
               if _in_search_window(o.get("created_at"), window)]
        if not inc and not upd and not obs:
            lines.append(f"• {m['path']}: nothing recorded in this window.")
            continue
        lines.append(f"• {m['path']}: {len(inc)} incident(s), "
                     f"{len(upd)} update(s), {len(obs)} observation(s)")
        for i in inc[:4]:
            lines.append(f"  ↳ incident #{i['id']} [{i['severity']}] {i['title']}")
        for u in upd[:3]:
            lines.append(f"  ↳ update #{u['id']} ({u['log_date']}, {u['status']}): "
                         f"{(u['notes'] or '')[:140]}")
    for u in out.get("unmapped", []):
        inc = [i for i in u.get("incidents", [])
               if _in_search_window(i.get("reported_at"), window)]
        upd = [x for x in u.get("updates", [])
               if _in_search_window(x.get("log_date"), window)]
        if not inc and not upd:
            continue
        lines.append(f"• {u['label']} (unmapped): {len(inc)} incident(s), "
                     f"{len(upd)} update(s)")
        for i in inc[:4]:
            lines.append(f"  ↳ incident #{i['id']} [{i.get('severity')}] "
                         f"{i['title']}")
        for x in upd[:3]:
            lines.append(f"  ↳ update #{x['id']} ({x.get('log_date')}, "
                         f"{x.get('status')}): {(x.get('notes') or '')[:140]}")
    if not lines:
        return ("Area report:\nNothing recorded for these filters in "
                f"{window['label']}.")
    return "Area report:\n" + "\n".join(lines)
# The assistant NEVER touches tables directly and NEVER receives a database
# dump. It selects from these whitelisted read-only tools, scoped to one
# project. With an LLM key the model drives tool choice (OpenAI-style
# function calling via OpenRouter); without one, a deterministic router
# picks the same tools by keyword. Answers are generated ONLY from tool
# outputs — counts and IDs are quoted from results, never invented.

def _tool_project_summary(project_id: int) -> dict:
    conn = get_db()
    cursor = conn.cursor()
    p = cursor.execute("SELECT * FROM projects WHERE id = ?",
                       (project_id,)).fetchone()
    if p is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    insp = cursor.execute(
        "SELECT status, COUNT(*) c FROM inspections WHERE project_id = ? "
        "GROUP BY status", (project_id,)).fetchall()
    out = {
        "project": {"id": p["id"], "name": p["name"],
                    "status": p["status"] or "Active",
                    "description": p["description"] or "",
                    "progress": _col(p, "progress", 0),
                    "total_budget": _col(p, "total_budget", 0)},
        "inspections_by_status": {r["status"]: r["c"] for r in insp},
        "open_safety_incidents": cursor.execute(
            "SELECT COUNT(*) FROM safety_issues WHERE project_id = ? "
            "AND resolved_at IS NULL", (project_id,)).fetchone()[0],
        "open_risks": cursor.execute(
            "SELECT COUNT(*) FROM risks WHERE project_id = ? "
            "AND COALESCE(status, 'open') = 'open'", (project_id,)).fetchone()[0],
        "materials_tracked": cursor.execute(
            "SELECT COUNT(*) FROM materials WHERE project_id = ?",
            (project_id,)).fetchone()[0],
        "observations": cursor.execute(
            "SELECT COUNT(*) FROM observations WHERE project_id = ?",
            (project_id,)).fetchone()[0],
        "budget": _budget_line(cursor, p),
    }
    conn.close()
    return out


def _tool_recent_incidents(project_id: int, limit: int = 5,
                           days: int = 30) -> dict:
    from datetime import datetime as _dt, timedelta as _td
    limit = max(1, min(20, int(limit or 5)))
    days = max(1, min(90, int(days or 30)))
    cutoff = (_dt.now() - _td(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db()
    cursor = conn.cursor()
    rows = cursor.execute(
        "SELECT id, title, category, severity, reported_at, resolved_at, "
        "COALESCE(status, 'confirmed') AS status FROM safety_issues "
        "WHERE project_id = ? AND reported_at >= ? "
        "ORDER BY reported_at DESC LIMIT ?", (project_id, cutoff, limit)).fetchall()
    conn.close()
    return {"project_id": project_id, "window_days": days,
            "incidents": [dict(r) for r in rows]}


def _tool_area_issues(project_id: int, area: str | None = None,
                      building: str | None = None,
                      floor: str | None = None) -> dict:
    data = _heatmap_data(project_id)
    matches = []
    for s in data["sites"]:
        for b in s["buildings"]:
            if building and _heat_norm(b["name"]) != _heat_norm(building):
                continue
            for f in b["floors"]:
                if floor and _heat_norm(f["name"]) != _heat_norm(floor):
                    continue
                for a in f["areas"]:
                    if area and _heat_norm(a["name"]) != _heat_norm(area):
                        continue
                    matches.append({
                        "path": f"{s['name']} / {b['name']} / {f['name']} / {a['name']}",
                        **a})
            for a in b.get("direct_areas", []):
                if floor or (area and _heat_norm(a["name"]) != _heat_norm(area)):
                    continue
                matches.append({"path": f"{s['name']} / {b['name']} / {a['name']}",
                                **a})
        for a in s.get("site_areas", []):
            if (building or floor
                    or (area and _heat_norm(a["name"]) != _heat_norm(area))):
                continue
            matches.append({"path": f"{s['name']} / {a['name']}", **a})
    unmapped = [u for u in data["unmapped"]
                if not area or _heat_norm(area) in _heat_norm(u["label"])]
    return {"project_id": project_id,
            "filters": {"area": area, "building": building, "floor": floor},
            "match_count": len(matches), "matches": matches[:6],
            "unmapped": unmapped[:6],
            "note": ("No modelled area matches these filters — check "
                     "Unmapped, or register the location hierarchy.")
                    if (area or building or floor) and not matches else None}


def _tool_recurring_issues(project_id: int, days: int = 14,
                           min_occurrences: int = 3) -> dict:
    groups = _recurring_groups(project_id, days, min_occurrences)
    return {"project_id": project_id, "groups": groups}


def _tool_inventory_status(project_id: int) -> dict:
    fc = _forecast_report(project_id, 14)
    return {"project_id": project_id, "project_name": fc["project_name"],
            "window_days": fc["window_days"],
            "shortage_count": fc["shortage_count"],
            "materials": fc["materials"],
            "unmatched_mentions": fc["unmatched_mentions"]}


def _tool_budget_status(project_id: int) -> dict:
    return _budget_intel_data(project_id)


def _tool_project_progress(project_id: int) -> dict:
    from datetime import date as _date
    conn = get_db()
    cursor = conn.cursor()
    p = cursor.execute("SELECT * FROM projects WHERE id = ?",
                       (project_id,)).fetchone()
    if p is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    rows = cursor.execute(
        "SELECT id, log_date, source, status, notes FROM inspections "
        "WHERE project_id = ? ORDER BY id DESC LIMIT 5",
        (project_id,)).fetchall()
    conn.close()
    dates = []
    for r in rows:
        try:
            if r["log_date"]:
                dates.append(_date.fromisoformat(str(r["log_date"])[:10]))
        except (TypeError, ValueError):
            pass
    stale = (_date.today() - max(dates)).days if dates else None
    return {"project_id": project_id, "project_name": p["name"],
            "progress": _col(p, "progress", 0),
            "status": p["status"] or "Active",
            "days_since_last_update": stale,
            "recent_updates": [
                {"id": r["id"], "log_date": r["log_date"],
                 "source": r["source"], "status": r["status"],
                 "notes": (r["notes"] or "")[:280]} for r in rows]}


def _tool_risk_summary(project_id: int) -> dict:
    return _risk_scores(project_id)


def _tool_weekly_report(project_id: int, days: int = 7) -> dict:
    # Read-only: snapshots are written only by the explicit Generate button
    # (POST /api/reports/weekly), never by chat questions.
    return _weekly_report_data(project_id, days, save=False)


def _tool_portfolio_overview() -> dict:
    conn = get_db()
    cursor = conn.cursor()
    counts = _status_counts()
    pending = cursor.execute(
        "SELECT id, name, description FROM projects "
        "WHERE COALESCE(status,'Active') = 'Pending'").fetchall()
    projs = cursor.execute("SELECT * FROM projects ORDER BY id").fetchall()
    out = {"projects_total": sum(counts.values()), "by_status": counts,
           "pending": [dict(r) for r in pending],
           "shortfalls": _shortfalls()[:10],
           "budgets": [_budget_line(cursor, p) for p in projs],
           "inspections_total": cursor.execute(
               "SELECT COUNT(*) FROM inspections").fetchone()[0],
           "observations_total": cursor.execute(
               "SELECT COUNT(*) FROM observations").fetchone()[0]}
    conn.close()
    return out


_TOOLS = {
    "get_project_summary": (
        "Overall project facts: identity, progress, status counts, open "
        "incident/risk counts, tracked materials, observations, budget line.",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"}},
         "required": ["project_id"]},
        _tool_project_summary),
    "get_recent_incidents": (
        "Latest safety incidents in a day window, newest first, with "
        "pending/confirmed/dismissed review state.",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"},
                        "limit": {"type": "integer"},
                        "days": {"type": "integer"}},
         "required": ["project_id"]},
        _tool_recent_incidents),
    "get_area_issues": (
        "Everything recorded at one place: area/building/floor filters "
        "against the risk heatmap (incidents, observations, repeats, "
        "updates, AI detections, score, actions).",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"},
                        "area": {"type": "string"},
                        "building": {"type": "string"},
                        "floor": {"type": "string"}},
         "required": ["project_id"]},
        _tool_area_issues),
    "get_recurring_issues": (
        "DB-counted repeats: same issue + same location + minimum "
        "occurrences inside the day window.",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"},
                        "days": {"type": "integer"},
                        "min_occurrences": {"type": "integer"}},
         "required": ["project_id"]},
        _tool_recurring_issues),
    "get_inventory_status": (
        "Materials with stock, measured burn, days remaining and shortage "
        "verdicts over the last 14 days.",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"}},
         "required": ["project_id"]},
        _tool_inventory_status),
    "get_budget_status": (
        "Budget intelligence: original/spent/predicted/overrun, spend "
        "drivers, burn rate, committed liability, delay signals.",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"}},
         "required": ["project_id"]},
        _tool_budget_status),
    "get_project_progress": (
        "Progress percent, status, days since last update, and the latest "
        "daily updates with their notes.",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"}},
         "required": ["project_id"]},
        _tool_project_progress),
    "get_risk_summary": (
        "Explainable 0-100 risk scores (project/safety/inventory/budget/"
        "schedule), hotspot and WHY reasons.",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"}},
         "required": ["project_id"]},
        _tool_risk_summary),
    "get_weekly_report": (
        "Generate the week across all engines (updates, safety, repeats, "
        "inventory, budget, schedule, risks, alerts) with top risks and "
        "recommended actions. Snapshots the numbers for next week's deltas.",
        {"type": "object",
         "properties": {"project_id": {"type": "integer"},
                        "days": {"type": "integer"}},
         "required": ["project_id"]},
        _tool_weekly_report),
}


def _call_tool(name: str, args: dict | None, default_project):
    """Execute one whitelisted tool. Unknown names and missing projects
    raise — the agent loop turns that into an error result, never a query."""
    if name not in _TOOLS:
        raise ValueError(f"Unknown tool '{name}'. Available: "
                         + ", ".join(sorted(_TOOLS)))
    _desc, schema, fn = _TOOLS[name]
    a = dict(args or {})
    if "project_id" in schema["properties"] and a.get("project_id") is None:
        a["project_id"] = default_project
    if ("project_id" in schema.get("required", [])
            and a.get("project_id") is None):
        raise ValueError(f"Tool '{name}' needs a project_id.")
    if "limit" in a and a["limit"] is not None:
        a["limit"] = max(1, min(20, int(a["limit"])))
    if "days" in a and a["days"] is not None:
        a["days"] = max(1, min(90, int(a["days"])))
    if "min_occurrences" in a and a["min_occurrences"] is not None:
        a["min_occurrences"] = max(2, min(50, int(a["min_occurrences"])))
    a = {k: v for k, v in a.items() if k in schema["properties"]}
    return fn(**a)


def _parse_location(question: str, project_id):
    """Extract modelled place hints (area/building/floor) from prose.
    Hints matching nothing modelled are dropped — the tools must never
    filter on hallucinated places."""
    import re
    if not project_id:
        return {}
    found = {}
    m = re.search(r"\b(?:area|zone|block)\s+([A-Za-z0-9]+)", question, re.I)
    if m:
        found["area"] = m.group(0).strip()
    m = re.search(r"\bbuilding\s+([A-Za-z0-9]+)", question, re.I)
    if m:
        found["building"] = m.group(0).strip()
    m = re.search(r"\bfloor\s+([A-Za-z0-9]+)", question, re.I)
    if m:
        found["floor"] = m.group(0).strip()
    if not found:
        return {}
    conn = get_db()
    cursor = conn.cursor()
    try:
        area_names = {r[0].strip().lower() for r in cursor.execute(
            "SELECT name FROM areas WHERE site_id IN "
            "(SELECT id FROM sites WHERE project_id = ?)", (project_id,)).fetchall()
            if r[0]}
        bld_names = {r[0].strip().lower() for r in cursor.execute(
            "SELECT name FROM buildings WHERE site_id IN "
            "(SELECT id FROM sites WHERE project_id = ?)", (project_id,)).fetchall()
            if r[0]}
        flr_names = {r[0].strip().lower() for r in cursor.execute(
            "SELECT name FROM floors WHERE building_id IN "
            "(SELECT id FROM buildings WHERE site_id IN "
            "(SELECT id FROM sites WHERE project_id = ?))", (project_id,)).fetchall()
            if r[0]}
    finally:
        conn.close()
    keep = {}
    if "area" in found and found["area"].strip().lower() in area_names:
        keep["area"] = found["area"]
    if "building" in found and found["building"].strip().lower() in bld_names:
        keep["building"] = found["building"]
    if "floor" in found and found["floor"].strip().lower() in flr_names:
        keep["floor"] = found["floor"]
    # Free-text places with no modelled hierarchy still route to the area
    # tool with the raw hints — it matches record text and reports
    # Unmapped honestly instead of filtering on nothing.
    if not keep and found:
        keep = dict(found)
    return keep


def _render_tool_section(name: str, out: dict) -> str:
    """Deterministic narration of one tool's output (no-LLM path)."""
    if name == "get_project_summary":
        p = out["project"]
        lines = [f"Project #{p['id']}: {p['name']} [{p['status']}] — "
                 f"{p['description'] or 'no description'}",
                 f"Progress: {p['progress']}% · Budget: {p['total_budget']:g}"]
        st = out["inspections_by_status"]
        lines.append("Updates by status: " + (
            ", ".join(f"{k}: {v}" for k, v in sorted(st.items())) or "none"))
        lines.append(f"Open safety incidents: {out['open_safety_incidents']}, "
                     f"open risks: {out['open_risks']}, materials tracked: "
                     f"{out['materials_tracked']}, observations: {out['observations']}")
        lines.append("Budget: " + out["budget"])
        return "Project summary:\n" + "\n".join("• " + x for x in lines)
    if name == "get_recent_incidents":
        rows = out["incidents"]
        return ("Recent incidents "
                f"(last {out['window_days']} days):\n" + "\n".join(
                    f"• #{r['id']} [{r['severity']}] ({r['status']}) "
                    f"{r['title']}" for r in rows)
                or "Recent incidents:\nNone in this window.")
    if name == "get_area_issues":
        if not out["matches"] and not out["unmapped"]:
            return ("Area report:\nNo modelled area matches — "
                    + (out["note"] or "nothing recorded here."))
        lines = []
        for m in out["matches"]:
            d = m.get("detail", {})
            lines.append(
                f"• {m['path']}: risk {m['risk']['score']}/100 "
                f"({m['risk']['band']}) — "
                + "; ".join(d.get("reasons", [])[:3]))
            for act in d.get("actions", [])[:2]:
                lines.append(f"  ↳ action: {act}")
        for u in out["unmapped"]:
            c = u["counts"]
            lines.append(f"• {u['label']} (unmapped): {c['incidents']} "
                         f"incident(s), {c['observations']} observation(s), "
                         f"{c['updates']} update(s)")
        return "Area report:\n" + "\n".join(lines)
    if name == "get_recurring_issues":
        groups = out["groups"]
        return ("Recurring issues (DB-counted, ≥3 in 14 days):\n" + "\n".join(
            f"• {g['message']}" for g in groups[:5])
            or "Recurring issues:\nNo repeats meet the threshold.")
    if name == "get_inventory_status":
        if not out["materials"]:
            return "Inventory:\nNo materials tracked for this project."
        lines = []
        for it in out["materials"][:8]:
            if it["daily_consumption"] is None:
                lines.append(f"• {it['name']}: {it['stock']:g} {it['unit']} "
                             f"on hand — burn unknown")
            else:
                lines.append(
                    f"• {it['name']}: {it['stock']:g} {it['unit']}, "
                    f"~{it['daily_consumption']:g}/day → "
                    f"~{it['days_remaining']} day(s); needs "
                    f"{it['upcoming_requirement']:g} more"
                    f"{' — ⚠️ SHORTAGE: ' + it['reason'] if it['predicted_shortage'] else ''}")
        return "Inventory forecast (14-day burn):\n" + "\n".join(lines)
    if name == "get_budget_status":
        o = out
        if o["predicted_final"] is None:
            head = (f"Budget {_inr_compact(o['original_budget'])}, spent "
                    f"{_inr_compact(o['spent'])}, progress {o['progress']:g}% — "
                    f"no forecast yet ({o['note']})")
        else:
            head = (f"Budget {_inr_compact(o['original_budget'])}, spent "
                    f"{_inr_compact(o['spent'])}, predicted "
                    f"{_inr_compact(o['predicted_final'])} "
                    f"(overrun {_inr_compact(o['overrun'])} / "
                    f"{o['overrun_pct']:.1f}%) — risk {o['risk']}")
        return "Budget:\n• " + head + "\n" + "\n".join(
            "• " + c for c in o["contributors"][:6])
    if name == "get_project_progress":
        o = out
        lines = [f"Progress: {o['progress']}% [{o['status']}]"]
        if o["days_since_last_update"] is None:
            lines.append("No dated updates on record")
        else:
            lines.append(f"Last update {o['days_since_last_update']} day(s) ago")
        if o.get("note"):
            lines.append(o["note"])
        for r in o["recent_updates"]:
            lines.append(f"• #{r['id']} ({r['log_date'] or 'undated'}, "
                         f"{r['source'] or 'manual'}, {r['status']}): "
                         f"{(r['notes'] or '')[:200]}")
        return "Progress:\n" + "\n".join(lines)
    if name == "get_risk_summary":
        o = out
        lines = [f"• {k}: {v}/100 ({o['bands'][k]})"
                 for k, v in o["scores"].items()]
        if o["hotspot"]["label"]:
            lines.append(f"• Hotspot: {o['hotspot']['level']} RISK — "
                         f"{o['hotspot']['label']}")
        lines.append("• Why: " + "; ".join(o["top_reasons"][:6]))
        return "Risk scores (computed from live rows):\n" + "\n".join(lines)
    if name == "get_weekly_report":
        o = out
        p = o["progress"]
        d = p["delta_vs_last_report"]
        lines = [
            f"Week {o['week_start']} → {o['week_end']}"
            + (f" (report #{o['report_id']})" if o["report_id"] else
               " (preview — press Generate Weekly Report to snapshot)"),
            f"• Progress: {p['current']}%"
            + (f" ({d:+g} vs last report)" if d is not None
               else " (first snapshot — baseline established)"),
            f"• Daily updates: {o['daily_updates']['count']} · Safety incidents: "
            f"{o['safety']['reported_in_week']} "
            f"({', '.join(f'{k}×{v}' for k, v in sorted(o['safety']['by_severity'].items())) or 'none'})",
            f"• Recurring issues: {len(o['recurring'])} · Inventory warnings: "
            f"{o['inventory']['warnings']} · Risks raised: {o['risks']['raised_in_week']}",
        ]
        if o["budget"] and o["budget"]["overrun"] is not None:
            lines.append(
                f"• Budget variance: {o['budget']['formatted']['overrun']} "
                f"(predicted {o['budget']['formatted']['predicted']} vs "
                f"{o['budget']['formatted']['original']})")
        if o["schedule"]:
            lines.append(
                f"• Schedule: {o['schedule']['band']} "
                f"({o['schedule']['score']}/100)"
                + (" — " + "; ".join(o["schedule"]["delay_signals"][:2])
                   if o["schedule"]["delay_signals"] else ""))
        lines.append("Top risks:\n" + "\n".join(
            f"  {i + 1}. {t}" for i, t in enumerate(o["top_risks"][:3]))
            or "Top risks:\n  none recorded")
        lines.append("Recommended actions:\n" + "\n".join(
            f"  • {a}" for a in o["recommended_actions"][:5]))
        return "WEEKLY PROJECT REPORT — " + o["project_name"] + "\n" + "\n".join(lines)
    return f"{name}:\n(no renderer)"


def _pick_tools(question: str, project_id):
    """Deterministic intent → tool mapping (docs + no-LLM fallback share it)."""
    q = (question or "").lower()
    picks = []
    loc = _parse_location(question, project_id) if project_id else {}
    if loc:
        picks.append(("get_area_issues", dict(loc)))
    if any(k in q for k in ("recur", "repeat", "again", "often")):
        picks.append(("get_recurring_issues", {}))
    if any(k in q for k in ("material", "stock", "inventory", "shortage",
                            "forecast", "run out", "runs out", "consumption",
                            "predict")):
        picks.append(("get_inventory_status", {}))
    if any(k in q for k in ("budget", "cost", "spent", "overrun", "exceed",
                            "eac", "crore", "lakh")):
        picks.append(("get_budget_status", {}))
    if any(k in q for k in ("progress", "daily", "update", "today",
                            "yesterday", "latest")):
        picks.append(("get_project_progress", {}))
    if any(k in q for k in ("safety", "incident", "ppe", "helmet",
                            "violation")):
        picks.append(("get_recent_incidents", {}))
    if any(k in q for k in ("risk", "score", "why", "alert", "danger")):
        picks.append(("get_risk_summary", {}))
    if any(k in q for k in ("weekly", "this week", "week report",
                            "week in review")) or "report" in q.split():
        picks.append(("get_weekly_report", {}))
    if any(k in q for k in ("pending", "status", "project", "overview",
                            "summary")):
        picks.append(("get_project_summary", {}))
    if not picks and project_id:
        picks.append(("get_project_summary", {}))
    seen, ordered = set(), []
    for tool_name, args in picks:
        if tool_name not in seen:
            seen.add(tool_name)
            ordered.append((tool_name, args))
    return ordered[:4]


def _offline_tools_answer(question: str, project_id: int | None):
    """No-LLM path: pick tools by keyword, execute, narrate outputs.
    Returns (answer, tools_used)."""
    if not project_id:
        try:
            o = _tool_portfolio_overview()
        except Exception as e:
            return f"Could not load portfolio data ({e}).", []
        lines = [f"{o['projects_total']} project(s): " + (
            ", ".join(f"{k}: {v}" for k, v in sorted(o["by_status"].items())))]
        for r in o["pending"]:
            lines.append(f"• Pending #{r['id']}: {r['name']}")
        for s in o["shortfalls"][:6]:
            lines.append(f"• Short: {s}")
        for b in o["budgets"][:6]:
            lines.append(f"• {b}")
        lines.append("Pick a project for incident, area, risk and forecast detail.")
        return ("(Offline grounded mode — add OPENROUTER_API_KEY for LLM "
                "answers)\n\nPortfolio:\n" + "\n".join(lines), [])
    used, sections = [], []
    for tool_name, args in _pick_tools(question, project_id):
        try:
            out = _call_tool(tool_name, args, project_id)
            used.append(tool_name)
            sections.append(_render_tool_section(tool_name, out))
        except Exception as e:
            sections.append(f"{tool_name}:\nCould not load ({e}).")
    if not sections:
        sections.append(
            "I answer from stored records — try project progress, safety "
            "incidents, an area name, recurring issues, inventory, budget "
            "or risk scores.")
    return ("(Offline grounded mode — add OPENROUTER_API_KEY for LLM "
            "answers)\n\n" + "\n\n".join(sections), used)


def _offline_answer(question: str, project_id: int | None):
    """Backward-compatible alias (assistantEngine docs reference it)."""
    answer, _used = _offline_tools_answer(question, project_id)
    return answer


def _openrouter_tools_answer(question: str, project_id):
    """LLM path: the model chooses whitelisted tools, the backend runs them,
    the model narrates ONLY the returned rows. Returns (answer, tools_used)
    or (None, []) when no key is configured."""
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key:
        return None, []
    tools = [{"type": "function",
              "function": {"name": name, "description": desc,
                           "parameters": schema}}
             for name, (desc, schema, _fn) in _TOOLS.items()]
    scope = (f"Selected project id: {project_id}."
             if project_id else "No project selected: answer portfolio-wide.")
    messages = [
        {"role": "system", "content": (
            "You are BuildSafe, a construction site intelligence assistant. "
            "You have read-only tools over the site database — call them for "
            "EVERY factual claim, then answer ONLY from tool results with "
            "exact counts and IDs. Never invent rows, places, quantities or "
            "percentages; say what is not recorded. Be concise and "
            "site-practical.")},
        {"role": "user", "content": f"{scope}\nQuestion: {question}"},
    ]
    used = []
    for _round in range(4):
        payload = json.dumps({
            "model": OPENROUTER_MODEL,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
        }).encode()
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=payload,
            headers={"Authorization": f"Bearer {key}",
                     "Content-Type": "application/json",
                     "HTTP-Referer": "http://localhost:5174",
                     "X-Title": "BuildSafe"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
        msg = data["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        if not calls:
            return (msg.get("content") or "", used)
        messages.append({"role": "assistant", "content": msg.get("content"),
                         "tool_calls": calls})
        for tc in calls:
            fname = (tc.get("function") or {}).get("name", "")
            try:
                fargs = json.loads((tc.get("function") or {}).get("arguments")
                                   or "{}")
            except Exception:
                fargs = {}
            try:
                result = _call_tool(fname, fargs, project_id)
                if fname not in used:
                    used.append(fname)
            except Exception as e:
                result = {"error": str(e)}
            messages.append({"role": "tool",
                             "tool_call_id": tc.get("id", ""),
                             "name": fname,
                             "content": json.dumps(result, default=str)[:6000]})
    return ("I gathered the project data but ran out of reasoning steps — "
            "please ask a narrower question.", used)


@app.post("/api/genai/query")
def genai_query(req: GenAIRequest):
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    answer, tools_used, llm, model = None, [], False, None
    llm_note = ""
    if key:
        try:
            answer, tools_used = _openrouter_tools_answer(
                req.query_text, req.project_id)
            if answer:
                llm, model = True, OPENROUTER_MODEL
        except Exception as e:
            llm_note = f"\n\n(LLM error: {e})"
            answer, tools_used = None, []
    if not answer:
        try:
            answer, tools_used = _offline_tools_answer(
                req.query_text, req.project_id)
        except Exception as e:
            answer, tools_used = (f"Could not gather project data ({e})."), []
        answer += llm_note
    conn = get_db()
    conn.execute(
        "INSERT INTO genai_queries (query_text, project_id, response_text) VALUES (?, ?, ?)",
        (req.query_text, req.project_id, answer),
    )
    conn.commit()
    conn.close()
    return {"answer": answer, "llm": llm, "model": model,
            "llm_configured": bool(key), "tools_used": tools_used}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)