@echo off
setlocal
cd /d "%~dp0"

echo [1/3] ESLint...
call npm run lint
if errorlevel 1 exit /b 1

echo [2/3] TypeScript...
call npm run typecheck
if errorlevel 1 exit /b 1

echo [3/3] Production build...
call npm run build
if errorlevel 1 exit /b 1

echo.
echo All checks passed.
endlocal
