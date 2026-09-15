@echo off
REM ============================================================
REM  StarGuard (星宝守护) single-port launcher
REM  Backend serves the built frontend on ONE port (no Docker,
REM  no dev proxy, no CORS). Frontend API base is relative /api
REM  (see frontend/.env), so all requests are same-origin and
REM  pass the preview-panel CSP (connect-src 'self' ws: wss:).
REM  Default port = 3200 (3000 may be held by a stale instance).
REM ============================================================
cd /d "%~dp0"

REM --- build frontend (bakes relative /api base) ---
cd frontend
echo [start-app] building frontend...
call npm run build
cd ..

REM --- build backend if not built ---
cd backend
if not exist dist (
  echo [start-app] backend/dist not found - building backend...
  call npm run build
)

set PORT=3200
echo [start-app] StarGuard starting on http://localhost:%PORT%/
echo [start-app] Open that URL in your browser. Press Ctrl+C to stop.
node dist/main.js
