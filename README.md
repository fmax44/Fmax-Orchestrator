# chatgpt-codex-mcp

Локальный MVP MCP-сервера для связки ChatGPT и Codex Desktop через файловую очередь, Git и отчёты.

ChatGPT в этой схеме выступает архитектором: ставит задачи, проверяет отчёты, смотрит diff и принимает решение. Codex Desktop остаётся исполнителем в локальном репозитории: читает markdown-задачи из `.codex/tasks`, делает изменения и пишет отчёты в `.codex/reports`.

## Статус реализации

MVP реализован:

- TypeScript + Node.js + официальный MCP TypeScript SDK.
- stdio MCP server.
- Файловая очередь задач в `.codex`.
- Хранение статусов в markdown и `.codex/state/tasks.json`.
- Git diff inspection.
- Безопасный запуск проверок с denylist и timeout.
- Решения архитектора в `.codex/decisions`.
- MCP tools, resources и prompts.
- Vitest-тесты для ключевых сценариев.
- MVP-3 tools для реального использования: `project_health`, `list_tasks`, `archive_task`.
- Bootstrap-команда для подготовки новых проектов.

## Быстрый старт

```bash
npm install
npm run build
npm test
```

Если npm на Windows падает с `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, запустите установку так:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm install
```

## Запуск MCP-сервера

После сборки:

```bash
npm run build
npm start
```

`npm start` удобен для ручной проверки в терминале, но MCP-клиенту нужно указывать
прямую stdio-команду без npm-обёртки:

```text
node D:\projects\chatgpt-codex-mcp\dist\index.js
```

Вывод `npm` или `tsx` в stdout до MCP `initialize` может быть принят клиентом за
protocol response и привести к `invalid initialize response`. Сам MCP runtime
перенаправляет console-логи в stderr; stdout зарезервирован только для JSON-RPC.

Для разработки:

```bash
npm run dev
```

Сервер использует stdio-транспорт, поэтому обычно его запускает MCP-клиент.

`run_tests` и `review_gate` возвращают timeout как structured result: команда
получает `timedOut: true`, exit code `124`, а Review Gate возвращает понятный
`BLOCKED`. Отмена MCP-запроса также передаётся дочерней команде, чтобы не оставлять
зависшие процессы.

## MVP-3: подготовка рабочего проекта

Перед использованием Orchestrator в реальном проекте проект должен быть Git-репозиторием.

Подготовить проект:

```powershell
npm run bootstrap -- --project "D:\projects\some-project"
```

Bootstrap делает следующее:

- проверяет, что папка проекта существует;
- проверяет, что проект является Git-репозиторием;
- создаёт `.codex/tasks`, `.codex/reports`, `.codex/decisions`, `.codex/state`, `.codex/archive`;
- создаёт `.codex/state/tasks.json`, если его нет;
- создаёт `.codex/README.md`;
- добавляет `.codex/` в `.gitignore`, если строки ещё нет;
- не удаляет существующие задачи и отчёты.

Проверить готовность проекта можно через MCP tool `project_health`.

Пример результата готового проекта:

```json
{
  "exists": true,
  "isGitRepo": true,
  "gitStatusClean": true,
  "codexDirExists": true,
  "tasksStateExists": true,
  "gitignoreHasCodex": true,
  "packageManager": "npm",
  "availableChecks": ["npm run build", "npm test", "npm run lint"],
  "warnings": [],
  "ready": true
}
```

Посмотреть задачи:

```json
{
  "projectPath": "D:\\projects\\some-project",
  "status": "pending"
}
```

Используется tool `list_tasks`. `status` необязателен.

Архивировать завершённую задачу:

```json
{
  "projectPath": "D:\\projects\\some-project",
  "taskId": "0001",
  "reason": "Task completed and committed"
}
```

Используется tool `archive_task`. Архивировать можно только задачи со статусом `approved` или `rejected`.

## MVP-4: doctor и smoke

MVP-4 добавляет эксплуатационные проверки для ежедневной работы.

Проверить сам Orchestrator:

```powershell
npm run doctor
```

Проверить Orchestrator и целевой проект:

```powershell
npm run doctor -- --project "D:\projects\some-project"
```

Получить машинно-читаемый JSON:

```powershell
npm run doctor -- --format json
npm run doctor -- --project "D:\projects\some-project" --format json
```

Doctor возвращает один из статусов:

- `READY` - можно работать;
- `READY_WITH_WARNINGS` - можно работать после осознанной оценки предупреждений;
- `NOT_READY` - сначала нужно исправить ошибки.

Smoke-проверка проекта:

```powershell
npm run smoke -- --project "D:\projects\some-project"
```

JSON-вывод smoke:

```powershell
npm run smoke -- --project "D:\projects\some-project" --format json
```

Smoke создаёт служебную задачу и отчёт внутри `.codex`, проверяет чтение отчёта, diff и чистый Git status. Он не меняет бизнес-код и не должен менять tracked files проекта, если `.codex/` правильно исключён из Git.

Когда использовать doctor:

- перед началом рабочего дня;
- перед подключением нового проекта;
- если MCP-клиент ведёт себя неожиданно;
- перед постановкой первой задачи.

Когда использовать smoke:

- после bootstrap нового проекта;
- после обновления Orchestrator;
- перед важной рабочей сессией;
- если нужно проверить end-to-end flow без изменения продуктового кода.

## Подключение к MCP-клиенту

Пример конфигурации MCP-клиента:

```json
{
  "mcpServers": {
    "chatgpt-codex-mcp": {
      "command": "node",
      "args": ["D:\\projects\\chatgpt-codex-mcp\\dist\\index.js"],
      "env": {
        "CODEX_MCP_DEFAULT_PROJECT": "D:\\projects\\some-project"
      }
    }
  }
}
```

`CODEX_MCP_DEFAULT_PROJECT` нужен только для статических resources. Tools принимают `projectPath` явно.

## Рабочий цикл ChatGPT + Codex

1. ChatGPT вызывает `create_task` и создаёт markdown-задачу.
2. Codex Desktop читает `.codex/tasks/0001-task.md` в управляемом проекте.
3. Codex выполняет задачу маленькими изменениями.
4. Codex создаёт отчёт `.codex/reports/0001-report.md`.
5. ChatGPT вызывает `read_report`, `inspect_diff` и `run_tests`.
6. ChatGPT принимает задачу через `approve_task` или возвращает через `reject_task`.
7. ChatGPT создаёт следующую задачу через `create_next_task`.

MVP не запускает Codex Desktop автоматически. Связка намеренно построена через Git, файловую очередь и отчёты.

Для relay-сводки и следующей задачи:

```powershell
npm run relay:status -- --project "D:\projects\some-project"
npm run codex:next -- --project "D:\projects\some-project"
```

`relay:status` показывает текущую relay-точку: `waitingFor`, `nextActor`, `nextAction`.
`codex:next` находит следующую pending task, показывает `taskPath`, ожидаемый `reportPath` и инструкцию для Codex. При `--watch` команда ждёт появления report, но не делает approve автоматически.

## Структура `.codex`

В каждом управляемом проекте сервер создаёт:

```text
.codex
├── tasks
├── reports
├── decisions
├── state
└── archive
```

Задачи лежат в `.codex/tasks`, отчёты в `.codex/reports`, статусы в `.codex/state/tasks.json`, решения архитектора в `.codex/decisions`.

## Manual Codex Desktop Mode

Основной стабильный workflow остаётся ручным для Codex Desktop:

1. ChatGPT/MCP создаёт задачу в `.codex/tasks`.
2. Пользователь открывает Codex Desktop.
3. Codex Desktop читает `.codex/tasks/<id>-task.md`.
4. Codex Desktop делает изменения и пишет `.codex/reports/<id>-report.md`.
5. ChatGPT/MCP запускает `review_gate`, затем `approve_task` или `reject_task`.
6. Commit/push выполняются только отдельным осознанным шагом после проверки.

Codex CLI direct execution не является основным сценарием. `npm run codex:run-once` и MCP `codex_autonomous_run` оставлены как экспериментальный opt-in: без явного `--direct-execution` или `allowDirectExecution=true` они не вызывают `codex exec`, быстро возвращают manual/blocked result и подсказывают открыть Codex Desktop.

См. также [Manual Codex Desktop workflow](docs/MANUAL_CODEX_DESKTOP_WORKFLOW_RU.md).

## Tools

- `create_task` создаёт новую задачу.
- `get_task_status` возвращает одну задачу или весь список.
- `read_report` читает markdown-отчёт Codex.
- `inspect_diff` показывает git diff в режимах `summary`, `full`, `stat`, `names`.
- `run_tests` запускает проверки из `projectPath`.
- `approve_task` переводит задачу в `approved` и пишет решение.
- `reject_task` переводит задачу в `rejected`, создаёт `0001-fix.md` и пишет решение.
- `create_next_task` создаёт следующую задачу на основе предыдущей задачи и отчёта.
- `project_health` проверяет готовность проекта к Orchestrator workflow.
- `list_tasks` показывает очередь задач, опционально фильтруя по статусу.
- `archive_task` переносит завершённую задачу в `.codex/archive/<id>/`.
- `doctor` запускает диагностику Orchestrator и, опционально, target project.
- `smoke_check` запускает безопасную smoke-проверку target project.
- `project_status` возвращает полную status-сводку, включая `waitingFor`, `nextActor` и `nextAction`.

Дополнительная документация по relay:

- `docs/REAL_RELAY_WORKFLOW_RU.md`
- `docs/NO_MANUAL_COPY_WORKFLOW_RU.md`

## Resources

- `project_state` возвращает задачи, git status, наличие отчётов и последние решения.
- `task_queue` возвращает содержимое очереди задач.
- `architect_log` возвращает журнал решений.

Статические resources читают проект из `CODEX_MCP_DEFAULT_PROJECT`. Для произвольного пути есть шаблон `codex://project_state/{encodedProjectPath}`.

## Prompts

- `architect_review_prompt` помогает ChatGPT проверить результат Codex.
- `next_task_prompt` помогает сформулировать следующую маленькую задачу.

## Поддерживаемые проверки

`run_tests` принимает список команд, например:

```json
{
  "projectPath": "D:\\projects\\some-project",
  "commands": ["npm run build", "npm test"]
}
```

Команды выполняются из `projectPath`, получают timeout и проходят через простой denylist.

## Ограничения безопасности MVP

- `.env` не читается по умолчанию.
- Секретоподобные значения в выводе редактируются.
- Команды запускаются только из существующего `projectPath`.
- Опасные команды блокируются по denylist: `rm -rf`, `del /s`, `format`, `shutdown`, вывод env/secrets, чтение `.env`, `powershell Invoke-WebRequest` без явного разрешения.
- Длинный diff/output обрезается.
- Полный diff для `.env`-like файлов не читается.
- Git-репозиторий должен быть инициализирован до использования `inspect_diff`.
- MCP не запускает Codex Desktop автоматически.
- Audit-записи пишутся в `.codex/decisions`.

## Разработка

```bash
npm run build
npm test
```

Основные файлы:

- `src/services/taskStore.ts` файловая очередь задач.
- `src/services/gitService.ts` git status/diff.
- `src/services/testRunner.ts` запуск проверок.
- `src/utils/safeExec.ts` безопасное выполнение команд.
- `src/mcp/tools.ts` MCP tools.
- `src/mcp/server.ts` stdio server, resources и prompts.
- `src/services/projectBootstrap.ts` подготовка проекта к workflow.
- `src/services/projectHealth.ts` проверка готовности проекта.
- `src/services/doctor.ts` эксплуатационная диагностика.
- `src/services/smokeRunner.ts` smoke-проверка workflow.

## Документы

- [Рабочий регламент ChatGPT + Codex + MCP Orchestrator](docs/WORKFLOW_RU.md)
- [Architecture Decision Log](docs/ADR_RU.md)
- [Эксплуатация MCP Orchestrator](docs/OPERATIONS_RU.md)
- [Project Policy](docs/POLICY_RU.md)
- [Review Gate](docs/REVIEW_GATE_RU.md)
- [Project Status](docs/STATUS_RU.md)
- [Шаблон задачи для реального проекта](examples/real-project-task-template.md)

## MVP-6: ephemeral smoke and Docker Compose profile

For daily checks, prefer ephemeral smoke so normal task IDs are not consumed:

Для ежедневных проверок используйте smoke `--ephemeral`, чтобы не расходовать обычные task IDs.

```powershell
npm run smoke -- --project "D:\projects\some-project" --ephemeral
```

Ephemeral smoke writes only to `.codex/smoke/tasks`, `.codex/smoke/reports`, and `.codex/smoke/state`. It must not change the normal `.codex/state/tasks.json` queue or create regular files in `.codex/tasks`.

Docker Compose projects can use a safe profile:

```powershell
npm run doctor -- --project "D:\projects\some-project" --profile docker-compose
npm run smoke -- --project "D:\projects\some-project" --profile docker-compose --ephemeral
```

The Docker Compose profile checks for a compose file, runs `docker compose version`, and verifies that `docker compose ps` can execute. `docker compose config` is not executed by default because its output may contain resolved env values. If needed, run it explicitly:

```powershell
npm run doctor -- --project "D:\projects\some-project" --profile docker-compose --allow-compose-config-output
```

Even with `--allow-compose-config-output`, reports store only pass/fail, exit code, and a warning. Full `docker compose config` stdout/stderr is intentionally not stored.

## MVP-7: project policy

Projects can define local safety rules in:

```text
.codex/project-policy.json
```

Create a policy during bootstrap:

```powershell
npm run bootstrap -- --project "D:\projects\some-project" --policy basic
npm run bootstrap -- --project "D:\projects\some-node-project" --policy node
npm run bootstrap -- --project "D:\projects\syscool-kb" --policy docker-compose
```

Existing policy files are not overwritten unless `--force-policy` is passed.

Inspect and validate policy:

```powershell
npm run policy -- --project "D:\projects\some-project"
npm run policy -- --project "D:\projects\some-project" --format json
npm run policy -- --project "D:\projects\some-project" --validate-task 0001
npm run policy -- --project "D:\projects\some-project" --validate-diff
```

Policy-aware MCP tools:

- `read_policy`
- `validate_task_against_policy`
- `validate_diff_against_policy`

`create_task` checks policy before writing a task and adds a `Policy Notes` section to the generated markdown.

## MVP-8: Review Gate

Review Gate is the standard pre-approval check before `approve_task`.

```powershell
npm run review -- --project "D:\projects\some-project" --task 0001
npm run review -- --project "D:\projects\some-project" --task 0001 --format json
npm run review -- --project "D:\projects\some-project" --task 0001 --write-report
```

MCP tool:

```text
review_gate
```

Review Gate returns:

- `APPROVABLE` - `approve_task` is allowed.
- `NEEDS_REVIEW` - `approve_task` requires `overrideReviewGate: true`.
- `BLOCKED` - `approve_task` is blocked unless `force: true` and `forceReason` are provided.

## MVP-9: Strict Workflow Mode and audit provenance

Strict workflow mode makes Review Gate provenance a required part of approval.

- `review --write-report` writes `.codex/reports/<task>-review.md`.
- The review result is hashed and saved into `.codex/state/tasks.json` as `lastReviewGate`.
- Strict `approve_task` and CLI `approve` validate stored provenance before approval.
- `overrideReviewGate` can bypass only `NEEDS_REVIEW`.
- `force` can bypass only `BLOCKED`, and only with non-empty `forceReason`.

Workflow settings live in `.codex/project-policy.json` under `workflow`:

- `strictReviewGate`
- `requireReviewReportBeforeApprove`
- `maxReviewAgeMinutes`
- `requireCleanGitForApprove`

Recommended strict flow:

```powershell
npm run review -- --project "D:\projects\some-project" --task 0001 --write-report --format json
npm run approve -- --project "D:\projects\some-project" --task 0001 --decision "Approved after strict review"
```

`npm run review -- --format json` now includes `reviewHash`, `reviewReportPath`, and `validUntil`.

## MVP-10: Project Status Dashboard CLI

Use `status` when you need one quick dashboard-style answer for a managed project:

```powershell
npm run status -- --project "D:\projects\some-project"
npm run status -- --project "D:\projects\some-project" --format json
```

MCP tool:

```text
project_status
```

The status summary includes Git, policy, doctor readiness, task queue counts, latest reports, Review Gate provenance, stale review detection, and `recommendedAction`.

## MVP-11: Desktop Dashboard and Launcher

You can now run a local launcher/dashboard for Windows operations:

```powershell
Copy-Item .\scripts\fmax-orchestrator.config.example.json .\scripts\fmax-orchestrator.config.local.json
npm run dashboard:open
```

Dashboard CLI help:

```powershell
npm run dashboard -- --help
```

Additional dashboard scripts:

- `npm run dashboard`
- `npm run dashboard:open`
- `npm run dashboard:start -- --open`

HTTP endpoints:

- `GET /`
- `HEAD /`
- `GET /health`
- `GET /healthz`
- `GET /api/status`

Or create a Desktop shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1
```

The dashboard centralizes:

- ChatGPT open action
- Codex Desktop open action
- VPN app open action
- MCP / tunnel / Codex Worker action buttons with inline failure messages
- tunnel health (`healthz` / `readyz`)
- managed project cards powered by `project_status`
- local IPv4 and optional public IP lookup

Notes:

- On Windows the launcher now starts `.cmd`, `.bat`, and `.ps1` commands through a Windows-safe detached spawn path to avoid `spawn EINVAL` for dashboard actions such as `start-mcp`.
- Russian dashboard HTML is served as UTF-8 (`charset=utf-8`) and covered by tests.
- Dashboard action buttons expose state in `/api/status` and use visual colors: blue idle/starting, green running, red failed, gray disabled.
- Launch-only actions such as ChatGPT, Codex, VPN, and config open stay idle after launch instead of showing false permanent running status.
- The Codex Worker card renders only compact diagnostics; raw session logs stay in the worker status file/report.
- Codex Worker is optional/manual by default: it watches task/report state and shows "Manual Codex Desktop mode" when direct execution is disabled.
- `codex:run-once` is experimental and disabled by default. It requires both config opt-in and an explicit `--direct-execution` CLI flag before `codex exec` can run.
- Direct POST calls to disabled or unconfigured dashboard actions return a clear `400` instead of a generic `500`.

See [docs/DESKTOP_DASHBOARD_RUNBOOK_RU.md](docs/DESKTOP_DASHBOARD_RUNBOOK_RU.md) for the Russian runbook.
