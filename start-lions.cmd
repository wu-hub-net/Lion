@echo off
setlocal
title LIONS Website Launcher

cd /d "%~dp0"
set "LIONS_PORT=4174"
set "LIONS_URL=http://127.0.0.1:%LIONS_PORT%/"

powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing '%LIONS_URL%api/deepseek/status' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto open_site

where py.exe >nul 2>nul
if not errorlevel 1 (
  start "LIONS Local Server" /min py.exe -3 "%~dp0serve-lions.py" %LIONS_PORT%
  goto wait_for_server
)

where python.exe >nul 2>nul
if not errorlevel 1 (
  start "LIONS Local Server" /min python.exe "%~dp0serve-lions.py" %LIONS_PORT%
  goto wait_for_server
)

echo.
echo Python was not found. Install Python 3 and run this file again.
echo.
pause
exit /b 1

:wait_for_server
echo Starting LIONS at %LIONS_URL%
for /l %%I in (1,1,10) do (
  powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing '%LIONS_URL%api/deepseek/status' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto open_site
  timeout /t 1 /nobreak >nul
)

echo.
echo The local server did not start. Check whether port %LIONS_PORT% is available.
echo.
pause
exit /b 1

:open_site
if /i "%~1"=="--no-browser" (
  echo LIONS is ready at %LIONS_URL%
  endlocal
  exit /b 0
)
start "" "%LIONS_URL%"
endlocal
exit /b 0
