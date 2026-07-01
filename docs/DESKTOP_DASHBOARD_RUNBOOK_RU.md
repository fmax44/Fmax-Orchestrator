# Fmax-Orchestrator Desktop Dashboard Runbook

## Что это

`Fmax-Orchestrator` можно использовать как локальный desktop launcher и status board:

1. dashboard открывается на `http://127.0.0.1:47821/`
2. показывает состояние VPN, Tunnel, MCP, Codex Worker и managed projects
3. даёт кнопки запуска локальных компонентов
4. не делает auto-commit, auto-push и не хранит реальные секреты в репозитории

## Первичная настройка на Windows

1. Откройте `D:\projects\chatgpt-codex-mcp`.
2. Создайте local config:

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

## Как запускать dashboard

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-dashboard.ps1
```

Или:

```powershell
npm run dashboard:start -- --open
```

## Codex Worker

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

## Controlled Autonomous Codex Run

Для одного контролируемого запуска:

```powershell
npm run codex:run-once -- --format json
npm run codex:run-once -- --project "D:\projects\chatgpt-codex-mcp" --dry-run --format json
```

Гарантии:

- direct execution остаётся opt-in
- `dry-run` не вызывает `codex exec`
- нет GUI automation, clipboard automation, window control или prompt injection
- нет auto-approve, auto-commit, auto-push или auto-archive

## Что уже автоматизировано

- Worker читает `managedProjects`.
- Worker находит следующую `pending` task.
- Worker подготавливает instruction для Codex.
- Worker пишет status snapshot.
- Dashboard показывает:
  - состояние Codex Worker
  - последнюю найденную задачу
  - статус report
  - состояние Codex CLI/direct execution

## Что ещё требует участия пользователя

- безопасного прямого управления Codex Desktop из CLI нет
- worker не умеет сам открыть окно Codex Desktop и вставить prompt
- Review Gate, approve/reject и commit остаются отдельными шагами workflow

## Диагностика MCP timeout

- Проверьте `npm run status -- --project "<path>"`.
- Затем проверьте `npm run doctor -- --project "<path>"`.
- Если зависает tool-call с проверкой команд, повторите через `run_tests` с `timeoutMs`.
- Если вывод команды слишком большой, смотрите сокращённый `stdout/stderr` и признак truncation.

## Диагностика EPERM и ENOENT

- Сверьте `.codex/state/tasks.json`, `.codex/tasks` и `.codex/reports`.
- Если missing task file ломает approve/status flow, task markdown теперь можно восстановить из state.
- Если report существует, но Review Gate его не видит, проверьте заголовок файла и кодировку UTF-8/UTF-8 BOM.

## Что значит Doctor NOT_READY

- Это означает настоящую fail-проверку: нет Git, нет `.codex`, нет `tasks.json`, broken policy или другой блокирующий сбой.
- Dirty Git должен отображаться отдельно как warning с конкретным объяснением.

## Как правильно закрывать reported task

1. Убедитесь, что создан `.codex/reports/<taskId>-report.md`.
2. Запустите `npm run review -- --project "<path>" --task <taskId> --write-report`.
3. Если получен `APPROVABLE`, можно делать approve штатным локальным способом.
4. Если получен `NEEDS_REVIEW`, сначала разберите `.codex/reports/<taskId>-review.md`.

## Что делать при Review Gate NEEDS_REVIEW

- Смотрите `Warnings`, `Errors` и `Changed Files` в review report.
- Используйте `status.nextAction` как следующую команду.
- После исправлений повторите `review`.

## Как проверять Codex CLI и direct execution

- `codex --help`
- `codex exec --help`
- `npm run codex:run-once -- --project "<path>" --dry-run`

В dry-run и worker status смотрите:

- `Direct execution enabled`
- `Direct execution reason`
- `Config source`
- `executionState`
- `last exit code`
- `last error`

## Безопасность

- `scripts\fmax-orchestrator.config.local.json` должен оставаться вне Git.
- `scripts\fmax-orchestrator-codex-worker.pid` и `scripts\fmax-orchestrator-codex-worker-status.json` тоже должны оставаться вне Git.
- Реальные секреты не должны попадать в tracked files.
