# Project Status

## Зачем нужна команда `status`

`status` даёт одну сводку по проекту: Git, policy, doctor readiness, очередь задач, последние отчёты, relay-state и рекомендуемое следующее действие.

## Что показывает `project_status`

- Git status и список изменённых файлов
- наличие project policy и `strictReviewGate`
- результат `doctor`
- счётчики задач по статусам
- текущую задачу
- наличие task report и review report
- `recommendedAction`
- `waitingFor`
- `nextActor`
- `nextAction`

## Как запускать

```powershell
npm run status -- --project "D:\projects\syscool-kb"
npm run status -- --project "D:\projects\syscool-kb" --format json
```

Полезные флаги:

- `--include-smoke`
- `--no-doctor`
- `--include-review`
- `--task 0001`

## Relay status

Для relay-ориентированной сводки:

```powershell
npm run relay:status -- --project "D:\projects\syscool-kb"
```

## Codex Worker

Запуск:

```powershell
npm run codex:worker
npm run codex:worker -- --once
npm run codex:worker -- --project "D:\projects\syscool-kb" --once --format json
```

Что уже автоматизировано:

- поиск следующей `pending` task
- подготовка инструкции для Codex
- ожидание появления report
- публикация worker status в dashboard и через MCP

Что ещё требует участия пользователя:

- открыть Codex Desktop или запустить официальный Codex CLI
- выполнить задачу
- дождаться report
- затем пройти Review Gate и approve/reject

## Controlled Autonomous Run

Для одного контролируемого запуска:

```powershell
npm run codex:run-once -- --format json
npm run codex:run-once -- --project "D:\projects\syscool-kb" --dry-run --format json
```

Поведение:

- ищет следующую `pending` task
- использует существующий worker runtime
- запускает `codex exec` только если `worker.directExecution.enabled = true`
- никогда не делает auto-approve, auto-commit, auto-push или auto-archive

Dry-run:

- показывает, что было бы запущено
- не вызывает `codex exec`

Terminal results:

- `report_detected`
- `report_missing`
- `timeout`
- `error`
- `blocked`
- `dry_run`

## Интерпретация `waitingFor`

- `user` — сначала нужно убрать blockers
- `chatgpt` — следующий шаг за ChatGPT
- `codex` — нужно исполнение задачи в Codex
- `review` — нужно запустить `review_gate`
- `commit` — task уже approved, но изменения ещё не зафиксированы

## Интерпретация Codex Worker states

- `idle` — pending task не найдено
- `task_found` — новая pending task найдена, payload для Codex подготовлен
- `waiting_for_codex` — worker ждёт report
- `report_detected` — report появился, дальше нужен review
- `error` — worker не смог обновить статус

## Диагностика MCP timeout

- Сначала запустите `npm run status -- --project "<path>" --format json`.
- Затем запустите `npm run doctor -- --project "<path>"`.
- Если зависает проверка команд, смотрите `run_tests` с явным `timeoutMs`.
- Длинный `stdout/stderr` теперь обрезается, поэтому ориентируйтесь на начало сообщения и признак truncation.
- MCP tool теперь должен возвращать структурированную ошибку вместо немого `502`, если проблема воспроизводится локально.

## Диагностика EPERM и ENOENT

- Сверьте `.codex/state/tasks.json` и физические файлы в `.codex/tasks` и `.codex/reports`.
- Если missing task file мешает approve/status flow, task markdown можно безопасно восстановить из state.
- Если report существует, но не читается, проверьте заголовок `# Report for Task <taskId>` и кодировку UTF-8/UTF-8 BOM.
- Если task/report действительно отсутствует, ошибка должна быть явной, а не скрытой.

## Что значит Doctor NOT_READY

- `NOT_READY` должен означать реальную fail-проверку: нет Git, нет `.codex`, нет `tasks.json`, broken policy или другая блокирующая ошибка.
- Dirty Git сам по себе должен быть warning, а не скрытым фатальным состоянием.
- Для точной причины смотрите секции `Warnings` и `Errors` в `doctor` и `status`.

## Как правильно закрывать reported task

1. Убедитесь, что существует `.codex/reports/<taskId>-report.md`.
2. Запустите `npm run review -- --project "<path>" --task <taskId> --write-report`.
3. Если получен `APPROVABLE`, только после этого выполняйте approve.
4. Если получен `NEEDS_REVIEW`, сначала разберите review report и причину в `status.nextAction`.

## Что делать при Review Gate NEEDS_REVIEW

- Откройте `.codex/reports/<taskId>-review.md`.
- Проверьте `Warnings`, `Errors` и `Changed Files`.
- Если проверка стала `NEEDS_REVIEW` из-за checks, повторите review с корректными checks или используйте checks, выведенные из task/policy.
- После исправлений повторите `npm run review -- --project "<path>" --task <taskId> --write-report`.

## Как проверять Codex CLI и direct execution

- Для CLI: `codex --help` и `codex exec --help`.
- Для worker runtime: `npm run codex:run-once -- --project "<path>" --dry-run`.
- Смотрите поля:
  - `Direct execution enabled`
  - `Direct execution reason`
  - `Config source`
  - `executionState`
- Если direct execution disabled, причина должна быть явно указана в выводе.
