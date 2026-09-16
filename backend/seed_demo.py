"""Seed (or clean) a coherent hackathon demo dataset. Stdlib only.

Usage, from the project root:
    backend/.venv/bin/python backend/seed_demo.py          # seed once (idempotent)
    backend/.venv/bin/python backend/seed_demo.py --clean  # remove demo rows

Builds: one demo project + Site > Building A > Floor 3 > Area B hierarchy,
materials with dated consumption mentions (powers the forecast), three
helmet incidents in Area B (powers recurrence + risk + heatmap), one
pending AI incident (powers the confirm/dismiss card), and a photo
observation (powers the dashboard feed). Nothing is mocked at runtime —
every screen reads these rows through the real APIs.
"""

import json
import sqlite3
import sys
from datetime import datetime, timedelta

import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "construction.db")
DEMO_PROJECT = "Demo Tower — Hackathon"


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def existing_demo(conn):
    return conn.execute("SELECT id FROM projects WHERE name = ?",
                        (DEMO_PROJECT,)).fetchone()


def seed():
    conn = connect()
    if existing_demo(conn):
        print("Demo already seeded — nothing to do. Use --clean first to reseed.")
        conn.close()
        return
    cur = conn.cursor()
    now = datetime.now()
    today = now.date()

    cur.execute(
        "INSERT INTO projects (name, description, status, total_budget, progress) "
        "VALUES (?, ?, 'Active', 5000000, 64)",
        (DEMO_PROJECT, "Hackathon demo: residential tower, Solapur — Phase 3"))
    pid = cur.lastrowid
    cur.execute("INSERT INTO sites (project_id, name, location) VALUES (?, 'Demo Site', 'Solapur')",
                (pid,))
    site = cur.lastrowid
    cur.execute("INSERT INTO buildings (site_id, name) VALUES (?, 'Building A')", (site,))
    bld = cur.lastrowid
    cur.execute("INSERT INTO floors (building_id, name, level) VALUES (?, 'Floor 3', 3)", (bld,))
    flr = cur.lastrowid
    cur.execute("INSERT INTO areas (site_id, building_id, floor_id, name) VALUES (?, ?, ?, 'Area B')",
                (site, bld, flr))
    area_b = cur.lastrowid
    cur.execute("INSERT INTO floors (building_id, name, level) VALUES (?, 'Floor 2', 2)", (bld,))
    flr2 = cur.lastrowid
    cur.execute("INSERT INTO areas (site_id, building_id, floor_id, name) VALUES (?, ?, ?, 'Area A')",
                (site, bld, flr2))

    cur.execute(
        "INSERT INTO materials (project_id, name, category, cost, required_qty, "
        "received_qty, used_qty, unit) VALUES (?, 'Cement', 'Concrete', 350, 1000, 800, 350, 'Bags')",
        (pid,))
    cur.execute(
        "INSERT INTO materials (project_id, name, category, cost, required_qty, "
        "received_qty, used_qty, unit) VALUES (?, 'Steel', 'Structural', 65000, 120, 100, 72, 'Tons')",
        (pid,))

    # Dated consumption mentions — the forecast measures burn from these.
    for back, qty in ((0, 42), (2, 40), (5, 38)):
        day = (today - timedelta(days=back)).isoformat()
        structured = json.dumps({
            "progress": [f"Slab pour progressing, day -{back}"],
            "materials": [{"name": "cement", "qty": qty, "unit": "bags"}],
            "material_low": [], "safety": [], "tomorrow": ["Curing"],
            "other": [], "summary": "Steady pour days"})
        cur.execute(
            "INSERT INTO inspections (project_id, status, notes, source, transcript, "
            "structured, area, log_date, site_id, building, floor) "
            "VALUES (?, 'On Track', ?, 'voice', 'Demo transcript', ?, 'Area B', ?, ?, 'A', '3')",
            (pid, f"Demo daily update ({day}): pour progressing, cement {qty} bags.",
             structured, day, site))

    # Three identical helmet incidents in Area B — the recurrence detector fires.
    for i in range(3):
        ts = (now - timedelta(days=i * 2)).strftime("%Y-%m-%d %H:%M:%S")
        cur.execute(
            "INSERT INTO safety_issues (project_id, title, description, category, "
            "severity, reported_at, reported_by, source, status, site_id, area_id) "
            "VALUES (?, 'Worker without helmet Area B', 'Repeated PPE checks show "
            "unhelmeted workers on the Floor 3 pour.', 'PPE', 'High', ?, 'Demo seed', "
            "'daily-update', 'confirmed', ?, ?)",
            (pid, ts, site, area_b))
    # One pending AI incident — the confirm/dismiss card has something to review.
    cur.execute(
        "INSERT INTO safety_issues (project_id, title, description, category, "
        "severity, reported_by, source, status, observation_id, confidence) "
        "VALUES (?, '2 worker(s) without helmets — Area B (pending AI review)', "
        "'Demo SiteVision finding awaiting supervisor review.', 'PPE', 'Medium', "
        "'SiteVision AI', 'vision-ai', 'pending', NULL, 62.5)",
        (pid,))
    pending_id = cur.lastrowid
    cur.execute(
        "INSERT INTO alerts (project_id, site_id, source, source_id, severity, title, status) "
        "VALUES (?, ?, 'vision', ?, 'Medium', 'Demo pending AI incident', 'open')",
        (pid, site, pending_id))

    # One photo observation so the dashboard feed and heatmap have AI evidence.
    details = json.dumps({"workers": 4, "helmets": 3, "no_helmet": 1,
                          "compliance_pct": 75.0, "engine": "demo-seed",
                          "zone": "Area B"})
    cur.execute(
        "INSERT INTO observations (project_id, area, kind, title, details, site_id) "
        "VALUES (?, 'Area B', 'photo', 'Photo: 4 worker(s), helmets 75%', ?, ?)",
        (pid, details, site))

    conn.commit()
    conn.close()
    print(f"Seeded '{DEMO_PROJECT}' (id {pid}):")
    print("  site > Building A > Floor 3 > Area B (+ Floor 2 / Area A)")
    print("  2 materials, 3 daily updates with burn, 3 confirmed + 1 pending incidents,")
    print("  1 photo observation, 1 open alert.")
    print("Walk the demo: Dashboard → Risk & Alerts (heatmap + scores) → "
          "SiteVision AI → GenAI Assistant → Reports (weekly) → Search.")


def clean():
    conn = connect()
    row = existing_demo(conn)
    if not row:
        print("No demo data found — nothing to clean.")
        conn.close()
        return
    pid = row["id"]
    cur = conn.cursor()
    site = cur.execute("SELECT id FROM sites WHERE project_id = ?",
                       (pid,)).fetchone()
    site_id = site["id"] if site else None
    for table in ("weekly_reports", "alerts", "genai_queries", "observations",
                  "safety_issues", "risks", "inspections", "materials"):
        cur.execute(f"DELETE FROM {table} WHERE project_id = ?", (pid,))
    if site_id is not None:
        bld = cur.execute("SELECT id FROM buildings WHERE site_id = ?",
                          (site_id,)).fetchone()
        if bld:
            cur.execute("DELETE FROM areas WHERE site_id = ?", (site_id,))
            cur.execute("DELETE FROM floors WHERE building_id = ?", (bld["id"],))
            cur.execute("DELETE FROM buildings WHERE id = ?", (bld["id"],))
        cur.execute("DELETE FROM sites WHERE id = ?", (site_id,))
    cur.execute("DELETE FROM projects WHERE id = ?", (pid,))
    conn.commit()
    conn.close()
    print(f"Removed demo project #{pid} and all its rows.")


if __name__ == "__main__":
    if "--clean" in sys.argv[1:]:
        clean()
    else:
        seed()
