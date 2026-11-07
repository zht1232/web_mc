@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund || goto :error
)
if not exist public\mc\manifest.json (
  echo Importing official Minecraft 26.2 assets...
  call npm run assets || goto :error
)
start "WebCraft 26.2 server" cmd /c "npm run dev"
timeout /t 3 /nobreak >/dev/null
start "" "http://127.0.0.1:5174/"
echo WebCraft 26.2 is running at http://127.0.0.1:5174/
echo Close the server window to stop it.
timeout /t 5 /nobreak >/dev/null
exit /b 0
:error
echo.
echo Startup failed. See the messages above.
pause
exit /b 1
