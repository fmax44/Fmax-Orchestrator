$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path ".\node_modules")) {
  Write-Host "Не найдена папка node_modules. Сначала выполните: npm install" -ForegroundColor Yellow
  exit 1
}

Write-Host "Запускаю Codex Worker..." -ForegroundColor Cyan
npm run codex:worker
