# ChatGPT Handoff

## Что это за проект

- Проект: `chatgpt-codex-mcp`
- Путь: `D:\projects\chatgpt-codex-mcp`
- Назначение: локальный Fmax-Orchestrator / MCP-оркестратор для связки ChatGPT и Codex с файловой очередью задач в `.codex`.

## Стабильная база

- Стабильный commit: `31920d74ec5da1e8a626a89b1c26490a3d94e01f`
- Сообщение commit: `feat: stabilize orchestrator workflow and add dashboard launcher`

## Что уже работает

- Файловая очередь задач и отчётов через `.codex/tasks`, `.codex/reports`, `.codex/state/tasks.json`.
- MCP tools для работы с задачами, отчётами, review gate и project status.
- Desktop dashboard и launcher.
- Codex Worker / Codex Bridge:
  - `npm run codex:worker`
  - `start_codex_worker`
  - `codex_worker_status`
  - worker читает `managedProjects`
  - находит следующую `pending` task
  - готовит instruction/payload для Codex
  - ждёт report
  - показывает status в dashboard и через MCP
- Опциональная интеграция с официальным `codex exec` уже добавлена в код task `0031`.
  - По умолчанию она выключена.
  - Безопасный sandbox по умолчанию: `read-only`.

## Что ещё не работает или требует осторожности

- Безопасного управления окном Codex Desktop из CLI нет.
- Worker не управляет мышью, клавиатурой, окном или prompt injection в Codex Desktop.
- Полная desktop automation не реализована.
- `codex exec` нельзя считать “включённым в прод” автоматически.
  - В `0031` добавлен opt-in режим.
  - Установка Codex CLI в этой задаче не делалась.
  - Реальное включение direct execution должно делаться только явно.

## Какие задачи уже сделаны

- `0029` — Build Codex Worker / Codex Bridge for automatic task execution
  - реализован worker/bridge
  - добавлены CLI, dashboard, MCP tools, docs, tests
- `0030` — E2E test Codex Worker detection only
  - smoke test подтвердил, что worker видит задачу и переходит в `waiting_for_codex`
- `0031` — Try official Codex CLI non-interactive automation
  - исследован официальный путь через `codex exec`
  - добавлен opt-in direct execution mode
  - default оставлен безопасным и выключенным
- `0033` — Create ChatGPT handoff file for new window
  - создаёт этот handoff-документ

## Какие задачи сейчас активны

- `0032` — `pending`
  - название: `Install official Codex CLI after current investigation`
  - важное правило: не брать `0032`, пока не подтверждено, что `0031` завершена и что в `0031` не выполнялась установка Codex CLI
  - по текущему состоянию `0031` уже завершена без установки Codex CLI, но новую установку всё равно нельзя делать без отдельного явного указания пользователя

## Что делать следующему ChatGPT

1. Работать в проекте `D:\projects\chatgpt-codex-mcp`.
2. Сначала посмотреть `git status --short`.
3. Не откатывать существующие незакоммиченные изменения.
4. При необходимости проверять состояние через Fmax-Orchestrator tools:
   - `project_status`
   - `read_report`
   - `review_gate`
   - `approve_task`
   - `reject_task`
   - `codex_next`
5. Если разговор пойдёт про официальный CLI:
   - помнить, что `0031` уже добавила opt-in поддержку `codex exec`
   - не устанавливать Codex CLI без отдельного подтверждения пользователя
   - не использовать сторонние Codex wrappers
6. Если пользователь попросит продолжать работу по worker/direct execution:
   - сначала опираться на report `0031`
   - потом уже решать, действительно ли нужна задача `0032`

## Ограничения, которые нужно соблюдать

- Не менять код без явной задачи пользователя.
- Не архивировать задачи автоматически.
- Не делать commit без явного разрешения пользователя.
- Не делать push без явного разрешения пользователя.
- Не использовать `git add .`.
- Не трогать `.codex/archive`.
- Не показывать и не менять секреты, токены, cookies, API keys.
- Не показывать и не менять `CONTROL_PLANE_API_KEY`.
- Не менять local-only файлы и секреты.
- Не устанавливать Codex CLI без отдельного подтверждения пользователя.
- Не использовать управление окном/мышью/клавиатурой Codex Desktop.

## Полезные файлы

- `docs/DESKTOP_DASHBOARD_RUNBOOK_RU.md`
- `docs/STATUS_RU.md`
- `.codex/reports/0029-report.md`
- `.codex/reports/0030-report.md`
- `.codex/reports/0031-report.md`

## Короткий статус одной фразой

Сейчас проект находится на стадии после внедрения Codex Worker и после безопасной opt-in интеграции официального `codex exec`; базовый worker уже работает, а любые следующие шаги по CLI-установке или реальному direct execution нужно делать только по явному запросу пользователя.
