# Fmax-Orchestrator Desktop Dashboard Runbook

## Что это

`Fmax-Orchestrator` можно использовать как локальный desktop launcher и status board:

1. dashboard открывается на `http://127.0.0.1:47821/`;
2. показывает состояние VPN, Tunnel, MCP, Codex Worker, IP и managed projects;
3. даёт кнопки запуска локальных компонентов;
4. не делает auto-commit, auto-push и не хранит реальные секреты в репозитории.

## Первичная настройка на Windows

1. Откройте `D:\projects\chatgpt-codex-mcp`.
2. Создайте локальный config:

```powershell
Copy-Item .\scripts\fmax-orchestrator.config.example.json .\scripts\fmax-orchestrator.config.local.json
```

3. При необходимости создайте desktop shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1
```

4. Заполните в `scripts\fmax-orchestrator.config.local.json` локальные пути и команды:
   - `apps.browserPath`
   - `apps.codexPath`
   - `apps.vpnPath`
   - `commands.tunnel`
   - `commands.mcpServer`
   - `commands.codexWorker`
   - `managedProjects`

`CONTROL_PLANE_API_KEY` должен оставаться только в local config или runtime env.

## Как запустить dashboard

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-dashboard.ps1
```

Или:

```powershell
npm run dashboard:start -- --open
```

## Порядок кнопок

Dashboard сохраняет основной рабочий порядок:

1. `Открыть VPN`
2. `Запустить Tunnel`
3. `Запустить MCP`
4. `Открыть ChatGPT`
5. `Открыть Codex`
6. `Открыть конфиг`
7. `Запустить Codex Worker`

`Запустить Codex Worker` добавлен в конец, чтобы не ломать уже привычный порядок первых шести действий.

## Как запустить Codex Worker

Из dashboard:

- нажмите `Запустить Codex Worker`

Из PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-codex-worker.ps1
```

Или напрямую:

```powershell
npm run codex:worker
```

Полезные варианты:

```powershell
npm run codex:worker -- --once
npm run codex:worker -- --project "D:\projects\orchestrator-product-trial" --once --format json
```

## Что уже автоматизировано

- Worker читает `managedProjects` из dashboard config.
- Worker находит следующую `pending` task через существующую очередь Orchestrator.
- Worker пишет status snapshot в локальный файл.
- Dashboard показывает статус `Codex Worker`, последнюю найденную задачу и статус report.
- MCP tools могут:
  - читать `codex_worker_status`
  - запускать `start_codex_worker`

## Что пока требует участия пользователя

- Безопасного прямого управления Codex Desktop из CLI нет.
- Worker не умеет сам открыть окно Codex и вставить prompt.
- После появления `task_found` или `waiting_for_codex` пользователь всё ещё должен выполнить задачу в Codex Desktop.
- Review Gate, approve/reject и commit остаются отдельными шагами workflow.

Это честное ограничение текущего этапа: сейчас реализован рабочий bridge уровня `task watcher + report watcher + dashboard/MCP status`.

## Что видно в Codex Worker card

- состояние `idle / task_found / waiting_for_codex / report_detected / error`;
- последняя найденная задача;
- найден ли report;
- ограничение по прямому запуску Codex Desktop.

## IP блок

Dashboard показывает:

- локальные IPv4;
- публичный IP;
- город;
- страну;
- fallback-статус, если lookup недоступен.

## Безопасность

- `scripts\fmax-orchestrator.config.local.json` игнорируется Git.
- `scripts\fmax-orchestrator-codex-worker.pid` и `scripts\fmax-orchestrator-codex-worker-status.json` тоже игнорируются Git.
- Никакие реальные ключи не должны попадать в tracked files.
## Controlled autonomous Codex run

Р”Р»СЏ РѕРґРЅРѕРіРѕ РєРѕРЅС‚СЂРѕР»РёСЂСѓРµРјРѕРіРѕ autonomous run РјРѕР¶РЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ:

```powershell
npm run codex:run-once -- --format json
```

РР»Рё С‡РµСЂРµР· MCP tool:

- `codex_autonomous_run`

Р‘РµР·РѕРїР°СЃРЅС‹Рµ РіСЂР°РЅРёС†С‹:

- direct execution РѕСЃС‚Р°С‘С‚СЃСЏ opt-in;
- `dry-run` РЅРµ РІС‹Р·С‹РІР°РµС‚ `codex exec`;
- РЅРµС‚ GUI automation, window control, clipboard automation РёР»Рё prompt injection;
- РЅРµС‚ auto-approve, auto-commit, auto-push Рё auto-archive.
