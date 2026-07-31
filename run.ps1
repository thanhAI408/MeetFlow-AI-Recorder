$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env.local")) {
  & "$PSScriptRoot\setup.ps1"
}
if (-not (Test-Path "node_modules")) {
  npm install
}
Write-Host "MeetFlow AI Recorder: http://localhost:3000"
npm run dev
