# BuildSafe API Reference

Base URL (dev): `http://localhost:8000`. Interactive docs: `GET /docs` (FastAPI auto-generated). Auth: `Authorization: Bearer <token>` from `/api/auth/*` (7-day TTL). All 36 routes verified live.

## Auth

| Method | Path | Use |
|---|---|---|
| POST | `/api/auth/register` | Create user (name, email, password, role) |
| POST | `/api/auth/login` | Get bearer token |
| GET | `/api/auth/me` | Current user from token |

Roles: Project Manager, Site Supervisor, Contractor, Safety Officer, Client/Owner, Admin.

## Projects & budget

| Method | Path | Use |
|---|---|---|
| GET/POST | `/api/projects` | List / create projects |
| GET/PUT | `/api/projects/{project_id}` | Read / update project |
| GET | `/api/projects/{project_id}/budget` | CPI budget (EAC = spent / progress%) |
| GET | `/api/projects/{project_id}/budget-intel` | Cost drivers, burn rate, delays |

## Daily updates, safety, risk

| Method | Path | Use |
|---|---|---|
| GET/POST | `/api/inspections?project_id=` | Daily-update register |
| GET/POST | `/api/materials?project_id=` | Inventory (required/received/used) |
| GET | `/api/materials/forecast?project_id=&window_days=14` | Shortage forecast |
| GET | `/api/safety_issues?project_id=&status=` | Safety register |
| POST | `/api/safety_issues/{issue_id}/confirm` | Confirm pending AI incident |
| POST | `/api/safety_issues/{issue_id}/dismiss` | Dismiss with reason |
| GET | `/api/risks` | Risk register |
| GET | `/api/ppe_violations` | PPE violation history |
| GET | `/api/issues/recurring?project_id=&days=14&min_occ=3` | Repeat-issue fingerprints |
| GET | `/api/risks/score?project_id=` | Project risk score |
| GET | `/api/sites/heatmap?project_id=` | Location risk heatmap |

## Voice updates (no API key needed)

| Method | Path | Use |
|---|---|---|
| POST | `/api/stt/transcribe` | Audio → transcript (browser STT first; server: OpenAI Whisper API if key, else offline faster-whisper). 25 MB max |
| POST | `/api/voice-updates/extract` | `{transcript}` → `{structured, engine, note}` — LLM extract → validate → 1 repair retry → loud heuristic fallback |
| POST | `/api/voice-updates` | Save confirmed update: fans out to inspections + materials usage + safety/risk/alerts + progress |

## Vision (no API key needed)

| Method | Path | Use |
|---|---|---|
| POST | `/api/vision/analyze-video` | Multipart `video` + `project_id` + `area`. YOLOv8-PPE (legacy HOG+HSV fallback, flagged `degraded`). 150 MB max. Low compliance → pending incident, never auto-verdict |
| POST | `/api/vision/analyze-image` | Multipart `image` + optional EXIF/GPS provenance fields. 15 MB max |
| GET | `/api/vision/model-status` | `{engine, yolo_installed, …}` |
| GET | `/api/observations?project_id=` | Past analyses (evidence trail) |

## Search, GenAI, reports, dashboard

| Method | Path | Use |
|---|---|---|
| GET | `/api/search?q=&area=` | Keyword search across projects/inspections/materials/observations |
| POST | `/api/search/nl` | `{query_text, project_id?, days?}` natural-language retrieval |
| POST | `/api/genai/query` | `{query_text, project_id?}` grounded assistant: reads DB via tools, LLM narrates only tool rows (offline grounded mode without key) |
| POST/GET | `/api/reports/weekly?project_id=&days=7` | Generate / fetch weekly report (stored snapshots → honest deltas) |
| GET | `/api/dashboard/summary` | Live counts + latest observation |

## Error shape

All errors are JSON: `{"detail": "<readable message>"}`. The frontend (`src/siteVision.js`) renders status + detail and never shows raw HTML or `[object Object]`.
