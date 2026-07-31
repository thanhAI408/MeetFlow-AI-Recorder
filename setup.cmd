@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Checking Node.js and npm...
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install Node.js 20 or newer first.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found. Reinstall Node.js with npm included.
  exit /b 1
)
node --version
npm --version

echo [2/3] Installing dependencies...
call npm install
if errorlevel 1 exit /b 1

echo [3/3] Preparing environment file...
if not exist ".env.local" (
  copy /Y ".env.example" ".env.local" >nul
  echo Created .env.local. Open it and add OPENAI_API_KEY.
) else (
  echo .env.local already exists.
)

echo.
echo Setup complete. Add the API key, then run: verify.cmd
endlocal
