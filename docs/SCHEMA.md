# BuildSafe Database Schema

SQLite file `backend/construction.db`, created by `init_db()` + `_migrate()` in `backend/main.py`. No ORM at runtime (raw `sqlite3`); `backend/database.py` models are kept for a future migration. Foreign keys are declared; enforcement is application-level.

## Entity map

```
projects ─┬─ materials (inventory: required / received / used qty)
           ├─ inspections (daily updates: transcript + structured JSON, area/building/floor, log_date)
           ├─ observations (video/photo analyses: title + details JSON)
           │    └─ site_images (evidence files + EXIF/device provenance)
           ├─ safety_issues (register: pending / confirmed / dismissed)
           ├─ risks ─┐
           ├─ ppe_violations
           ├─ sites ─┬─ buildings ── floors
           │        ├─ areas (building/floor links nullable: flat sites work)
           │        └─ alerts (unified queue: source + source_id → originating row)
           ├─ weekly_reports (payload JSON snapshots for honest deltas)
           └─ genai_queries (audit log of assistant Q&A)
users (PBKDF2-HMAC-SHA256 password hash + salt, role; HMAC-signed bearer tokens, 7-day TTL)
```

## Tables (base definitions; `_migrate()` adds location/transcript columns on pre-existing DBs)

- **projects**(id, name, description, status, total_budget, progress, created_at)
- **materials**(id, project_id, site_id, name, category, cost, required_qty, received_qty, used_qty, unit) — spent = Σ(cost × used_qty); on hand = received − used
- **inspections**(id, project_id, status [`On Track`|`Attention`|…], notes, source [`voice`|`typed`|`manual`], transcript, structured JSON, area, building, floor, site_id, log_date)
- **observations**(id, project_id, area, kind [`video`|`photo`], title, details JSON, created_at)
- **site_images**(id, project_id, site_id, observation_id, file_path, original_url, annotated_url, taken_at, lat, lon, provenance_source, created_at)
- **safety_issues**(id, project_id, site_id, area_id, title, description, category, severity, reported_at, resolved_at, reported_by, source [`manual`|`daily-update`|`vision-ai`], status [`pending`|`confirmed`|`dismissed`], observation_id, confidence)
- **risks**(id, project_id, site_id, …, title, description, category, severity, detected_at, mitigation_plan)
- **ppe_violations**(id, project_id, category, severity, detected_at, resolved_at, image_path)
- **sites**(id, project_id, name, location) → **buildings**(id, site_id, name) → **floors**(id, building_id, name, level); **areas**(id, site_id, building_id?, floor_id?, name, kind)
- **alerts**(id, project_id, site_id, source, source_id, severity, title, status, created_at, resolved_at)
- **weekly_reports**(id, project_id, week_start, created_at, payload JSON)
- **users**(id, name, email UNIQUE, password_hash, password_salt, role, created_at)
- **genai_queries**(id, query_text, project_id, response_text, created_at)

Hot-path indexes (`idx_*`) cover list-by-project, dashboard counts, and per-project-per-date lookups.
