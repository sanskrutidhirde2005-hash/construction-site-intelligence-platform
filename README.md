# BuildSafe — Construction Site Intelligence Platform

React (Vite) frontend + FastAPI + SQLite backend for managing construction projects,
site progress, materials, safety, and inspections — with on-device computer-vision
analysis (worker counts, helmet compliance, activity score with annotated frames)
and a GenAI assistant that answers from your actual stored project data.

## Features

**Project operations**
- Project registry with status, budget (₹ INR), and progress tracking
- Daily site updates (manual, typed, or voice-driven with transcript + structured extraction)
- Materials / inventory with required / received / used quantities and shortage forecasting
- Past projects & maintenance view, weekly report generation with honest deltas
- Global + natural-language search across projects, inspections, materials, observations

**Safety & risk intelligence**
- Safety-issue register with `pending → confirmed / dismissed` AI-incident workflow
- PPE violation history, risk register, recurring-issue fingerprinting (same issue + location + time window)
- Project risk scores, location risk heatmap (Site → Building → Floor → Area hierarchy)
- Unified alerts queue fed by risk / safety / inspection / budget / vision sources
- Budget intelligence: CPI forecast (EAC = spent ÷ progress), spend drivers, burn rate, delay signals

**AI (no key required for vision & voice)**
- **SiteVision:** upload site *videos* (`POST /api/vision/analyze-video`, 150 MB max) or
  *photos* (`POST /api/vision/analyze-image`, 15 MB max). YOLOv8-PPE when weights are
  present, CPU-only OpenCV fallback (HOG people detection + HSV hard-hat segmentation +
  frame-difference motion) flagged as `degraded`. Low compliance creates a *pending*
  incident for supervisor confirm/dismiss — never an auto-verdict. Annotated frames
  serve under `/static`.
- **Voice updates:** browser speech-to-text first; server fallback is offline
  faster-whisper (CPU) or hosted Whisper API if `OPENAI_API_KEY` is set.
  `extract → validate → 1 repair retry → heuristic fallback`, then confirmed saves fan
  out to inspections + material usage + safety/risk/alerts + progress.
- **GenAI assistant:** `POST /api/genai/query` reads live DB rows via tools and the LLM
  narrates only those rows. With `OPENROUTER_API_KEY` you get full LLM answers;
  without it, grounded offline answers that say so.

**Access control**
- Email + password auth (PBKDF2-HMAC-SHA256, HMAC-signed bearer tokens, 7-day TTL)
- Roles with per-section permissions: Project Manager, Site Supervisor, Contractor,
  Safety Officer, Client / Owner, Admin (project-member assignment is Admin-only)

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, React Router-less page state, FontAwesome, custom CSS |
| Backend | FastAPI, raw `sqlite3` (no ORM at runtime), Pydantic v2, `python-multipart` |
| Vision | YOLOv8 (`ultralytics`) + OpenCV (`opencv-python-headless` 4.x), NumPy, ONNX Runtime |
| Voice | Browser Web Speech API + `faster-whisper` (offline CPU) / OpenAI Whisper API |
| LLM | OpenRouter (`OPENROUTER_MODEL`, default `openai/gpt-4o-mini`) with offline grounded fallback |
| Tests / lint | Playwright (E2E), Oxlint |

## Architecture

```
Browser (React/Vite :5174) ──/api + /static proxy──▶ FastAPI (:8000)
                                                            │
                                    ┌───────────────────────┼───────────────────────┐
                                    ▼                       ▼                       ▼
                              SQLite file DB        Vision pipeline          GenAI / Voice
                         backend/construction.db   YOLOv8 → legacy HOG/HSV   OpenRouter LLM
                              (init_db + migrate)   frames → /static/frames   or offline grounded
```

Vite proxies `/api` and `/static` to `http://localhost:8000` (see `vite.config.js`).
Interactive backend docs: `http://localhost:8000/docs`.

## Project structure

```
├── src/                    # React frontend (pages, components, engines)
│   ├── App.jsx             # Auth gate, role permissions, sidebar routing
│   ├── SiteVisionAI.jsx / SiteVision.jsx / siteVision.js
│   ├── GenAI.jsx / GenAIAssistant.jsx / assistantEngine.js
│   ├── VoiceUpdate.jsx, DailyUpdates.jsx, RiskAlerts.jsx, BudgetIntel.jsx, …
├── backend/
│   ├── main.py             # App, schema (init_db + _migrate), auth, budget, safety, recurring
│   ├── routers/            # projects, materials, inspections, safety_issues, risks, ppe, genai
│   ├── vision.py / vision_yolo.py  # Legacy HOG/HSV + YOLOv8-PPE engines
│   ├── database.py / schemas.py / models/  # Reserved for future ORM migration
│   ├── seed_demo.py        # Idempotent demo seeder
│   └── requirements.txt
├── docs/API.md             # Full 36-route API reference
├── docs/SCHEMA.md          # SQLite schema + entity map
├── tests/e2e/              # Playwright end-to-end tests
├── public/                 # Favicon, logo, static assets
└── start-windows.bat       # Double-click Windows startup
```

## Prerequisites

- Node.js 18+ and npm
- Python 3.10+ (3.11 recommended)
- No GPU, Docker, or API key required for the core demo (vision + voice run offline on CPU)

## Quick start

**1. Backend** — `http://localhost:8000` (docs at `/docs`)

```bash
python -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

> Do **not** install `opencv-python` 5.x or mix `opencv-python` with
> `opencv-python-headless` — 5.x removed `cv2.HOGDescriptor`, which the legacy
> fallback engine needs. `requirements.txt` pins `<5` on purpose. For CUDA
> servers, install matching CPU/CUDA `torch` + `torchvision` builds first
> (see comments in `requirements.txt`).

**2. Frontend** — `http://localhost:5174`

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

**Windows:** double-click `start-windows.bat` (starts uvicorn :8000 + `npm run dev`).

**Production build:**

```bash
npm run build
npm run preview
```

## Demo data (one command)

Idempotent — safe to re-run:

```bash
backend/.venv/bin/python backend/seed_demo.py          # seed
backend/.venv/bin/python backend/seed_demo.py --clean  # remove demo rows
```

Builds **"Demo Tower — Hackathon"** with a Site → Building A → Floor 3 → Area B
hierarchy, materials with dated consumption, three helmet incidents in Area B
(recurrence + risk + heatmap light up), one pending AI incident (confirm/dismiss
card), and a photo observation.

**Suggested walk-through:** Dashboard → Risk & Alerts (heatmap, scores, repeats) →
SiteVision AI (upload a site clip/photo) → Voice update (record or type, confirm the
AI extraction) → GenAI Assistant ("What are the biggest problems in Building A?") →
Reports (Generate Weekly Report) → Search ("helmet in Area B").

## Configuration

```bash
cp backend/.env.example backend/.env   # then add your keys
```

| Variable | Required? | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | Optional (GenAI LLM answers) | Get one at https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | Optional | Default `openai/gpt-4o-mini` |
| `OPENAI_API_KEY` | Optional (voice) | Prefer hosted Whisper over offline faster-whisper |
| `WHISPER_MODEL` | Optional | `tiny` / `base` (default) / `small` / `medium` |
| `YOLO_MODEL_PATH` | Optional (vision) | e.g. `backend/models/ppe-yolov8s-v1.pt`; missing → legacy engine + `degraded: true` |
| `YOLO_CONF` / `YOLO_IOU` / `YOLO_IMGSZ` | Optional | Detection thresholds, defaults `0.25` / `0.45` / `640` |
| `AUTH_SECRET` | Change in production | HMAC signing secret for bearer tokens |

Without keys: video/image analysis, voice transcription (offline), and grounded
GenAI answers all still work.

## Auth & roles

Register from the login screen (`Create account`) or via API:

```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"secret123","role":"Project Manager"}'
```

Send `Authorization: Bearer <token>` on subsequent calls. `GET /api/auth/me`
validates the session; the frontend persists it in `localStorage`. Admins manage
project assignments via `PUT /api/projects/{id}/assignments` (see `docs/API.md`).

## API highlights

Full reference (all 36 routes): [`docs/API.md`](docs/API.md). Database map: [`docs/SCHEMA.md`](docs/SCHEMA.md).

| Endpoint | Use |
|---|---|
| `GET /api/dashboard/summary` | Live dashboard numbers |
| `GET/POST /api/projects` · `GET/PUT /api/projects/{id}` | Project CRUD |
| `GET /api/projects/{id}/budget` · `/budget-intel` | CPI forecast + cost drivers |
| `GET/POST /api/inspections` · `GET/POST /api/materials` | Daily updates + inventory |
| `GET /api/materials/forecast` | Shortage forecast |
| `POST /api/vision/analyze-video` · `/analyze-image` | Worker/helmet/activity analysis |
| `GET /api/observations` | Past analyses (evidence trail) |
| `POST /api/voice-updates/extract` · `POST /api/voice-updates` | Voice structuring + save fan-out |
| `GET /api/safety_issues` · `POST …/confirm` · `POST …/dismiss` | Pending-AI-incident workflow |
| `GET /api/issues/recurring` · `/api/risks/score` · `/api/sites/heatmap` | Recurrence, scores, heatmap |
| `GET /api/search` · `POST /api/search/nl` | Keyword + natural-language retrieval |
| `POST /api/genai/query` | Grounded Q&A (`query_text`, `project_id?`) |
| `POST/GET /api/reports/weekly` | Weekly report snapshots (honest deltas) |

Errors are JSON: `{"detail": "<readable message>"}`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev -- --port 5174` | Frontend dev server |
| `npm run build` / `npm run preview` | Production build / preview |
| `npm run lint` | Oxlint |
| `npm run test:e2e` | Playwright E2E (spins up backend :8000 + frontend :5174; override with `FRONTEND_URL` / `BACKEND_URL`) |
| `backend/.venv/bin/python backend/seed_demo.py [--clean]` | Seed / remove demo data |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cv2.HOGDescriptor` / `AttributeError` on vision | You installed opencv 5.x or mixed GUI + headless builds. Reinstall exactly `opencv-python-headless>=4.14,<5`. |
| `/api/stt/transcribe` returns 501 | Install `faster-whisper` (in requirements) or set `OPENAI_API_KEY`. |
| Vision always reports `degraded: true` | No YOLO weights found — set `YOLO_MODEL_PATH` to a valid `.pt` file. Legacy engine is working as designed. |
| GenAI says "offline grounded mode" | No `OPENROUTER_API_KEY` in `backend/.env`. Restart uvicorn after adding it. |
| Frontend shows proxy / connection errors | Backend must be up on :8000 first; Vite proxies `/api` + `/static` there. |
| Stale data after pulling | Restart uvicorn from the venv — `_migrate()` converges old DBs to the current schema on startup. |

## Docs

- [`docs/API.md`](docs/API.md) — full endpoint reference
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — SQLite schema and entity map
