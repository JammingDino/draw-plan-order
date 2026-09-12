@echo off
rem Draw · Plan · Order — serve the app locally and open it.
rem A real http:// origin is what unlocks IndexedDB, so boards survive restarts.
setlocal
cd /d "%~dp0"
set PORT=5273

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/
  python -m http.server %PORT%
  goto :eof
)

where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/
  npx --yes http-server -p %PORT% -c-1 .
  goto :eof
)

echo Neither Python nor Node was found. Opening the file directly instead —
echo boards will fall back to localStorage.
start "" "%~dp0index.html"
