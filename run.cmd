@echo off
setlocal
cd /d "%~dp0"

if not exist ".env.local" (
  echo Missing .env.local. Running setup.cmd first...
  call setup.cmd
  if errorlevel 1 exit /b 1
)

if not exist "node_modules" (
  echo Dependencies are missing. Installing...
  call npm install
  if errorlevel 1 exit /b 1
)

echo MeetFlow AI Recorder: http://localhost:3000
call npm run dev
endlocal
