$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path ".\node_modules")) {
  Write-Host "Не найдена папка node_modules. Сначала выполните: npm install" -ForegroundColor Yellow
  exit 1
}

Write-Host "Запускаю dashboard Fmax-Orchestrator..." -ForegroundColor Cyan
npm.cmd run dashboard:open
