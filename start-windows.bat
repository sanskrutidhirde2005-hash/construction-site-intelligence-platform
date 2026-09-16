@echo off
:: Windows-first startup script for construction-platform
:: Uses os.path.join style paths, CRLF-safe, SQLite file DB, npm run + uvicorn only

:: Set working directory to script location
cd /d "%~dp0"

:: Enable CRLF handling - keep as received, no line ending conversion
setlocal enabledelayedexpansion

:: Start backend with uvicorn (project-root package mode)
echo Starting Backend (uvicorn)...\
start /b "" python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 >NUL 2>&1
echo Backend started on http://localhost:8000

:: Start frontend with npm (vite dev server)
echo Starting Frontend (npm dev)...\
start /b "" cmd /c "npm run dev" >NUL 2>&1
echo Frontend starting on http://localhost:5173

echo.
echo Construction Platform is now running.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
pause