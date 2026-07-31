$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Không tìm thấy Node.js. Hãy cài Node.js 20 trở lên."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Không tìm thấy npm. Hãy cài lại Node.js kèm npm."
}

node --version
npm --version
npm install

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "Đã tạo .env.local. Hãy thêm OPENAI_API_KEY."
}
Write-Host "Hoàn tất. Chạy .\run.ps1 hoặc run.cmd."
