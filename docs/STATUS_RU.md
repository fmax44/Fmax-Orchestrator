# Project Status

## Зачем нужна команда `status`

`status` даёт одну сводку по проекту: Git, policy, doctor readiness, очередь задач, последние отчёты, relay-state и рекомендованное следующее действие.

## Что показывает `project_status`

- Git status и changed files
- наличие project policy и `strictReviewGate`
- результат doctor
- счётчики задач по статусам
- current task
- наличие task report и review report
- `recommendedAction`
- `waitingFor`
- `nextActor`
- `nextAction`

## Как запустить

```powershell
npm run status -- --project "D:\projects\syscool-kb"
npm run status -- --project "D:\projects\syscool-kb" --format json
```

Флаги:

- `--include-smoke`
- `--no-doctor`
- `--include-review`
- `--task 0001`

## Relay status

Для relay-ориентированной сводки:

```powershell
npm run relay:status -- --project "D:\projects\syscool-kb"
```

## Как запустить Codex Worker

```powershell
npm run codex:worker
npm run codex:worker -- --once
npm run codex:worker -- --project "D:\projects\syscool-kb" --once --format json
```

Worker использует `managedProjects` из dashboard config и пишет локальный status snapshot для dashboard и MCP.

## Что уже автоматизировано

- поиск следующей `pending` task;
- подготовка инструкции для Codex;
- ожидание появления report;
- публикация worker status в dashboard и через MCP tool `codex_worker_status`;
- запуск worker через MCP tool `start_codex_worker`.

## Что пока требует участия пользователя

- открыть Codex Desktop;
- выполнить задачу по инструкции worker;
- дождаться report;
- после этого пройти Review Gate и approve/reject.

Прямой безопасный автозапуск Codex Desktop из CLI пока честно не реализован.

## Интерпретация `waitingFor`

- `user` — сначала нужно убрать blockers
- `chatgpt` — следующий шаг за ChatGPT
- `codex` — нужно исполнение задачи в Codex
- `review` — нужно запустить `review_gate`
- `commit` — task уже approved, но изменения ещё не зафиксированы

## Интерпретация Codex Worker states

- `idle` — pending task не найдено
- `task_found` — новая pending task найдена, payload для Codex подготовлен
- `waiting_for_codex` — worker ждёт report по уже найденной задаче
- `report_detected` — report появился, дальше нужен review
- `error` — worker не смог обновить статус

## MCP tools

Теперь рядом с обычными relay tools доступны:

- `start_codex_worker`
- `codex_worker_status`

Это позволяет ChatGPT через Fmax-Orchestrator запустить локальный watcher и затем читать его состояние без ручного переноса текста между окнами.
## Controlled autonomous run

Р”РѕР±Р°РІР»РµРЅ РѕРґРёРЅ РєРѕРЅС‚СЂРѕР»РёСЂСѓРµРјС‹Р№ autonomous loop РґР»СЏ СЃР»РµРґСѓСЋС‰РµР№ `pending` task:

```powershell
npm run codex:run-once -- --format json
npm run codex:run-once -- --project "D:\projects\orchestrator-product-trial" --dry-run --format json
```

Р§С‚Рѕ РѕРЅ РґРµР»Р°РµС‚:

- РЅР°С…РѕРґРёС‚ СЃР»РµРґСѓСЋС‰СѓСЋ `pending` task;
- РёСЃРїРѕР»СЊР·СѓРµС‚ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№ `CodexWorkerService`;
- Р·Р°РїСѓСЃРєР°РµС‚ `codex exec` С‚РѕР»СЊРєРѕ РєРѕРіРґР° `worker.directExecution.enabled = true`;
- Р¶РґС‘С‚ report Рё РІРѕР·РІСЂР°С‰Р°РµС‚ СЃС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅС‹Р№ СЂРµР·СѓР»СЊС‚Р°С‚ РґР»СЏ ChatGPT;
- РЅРёРєРѕРіРґР° РЅРµ РґРµР»Р°РµС‚ auto-approve, auto-commit, auto-push РёР»Рё auto-archive.

Dry-run:

- РїРѕРєР°Р·С‹РІР°РµС‚, С‡С‚Рѕ Р±С‹ Р±С‹Р»Рѕ Р·Р°РїСѓС‰РµРЅРѕ;
- РЅРµ РІС‹Р·С‹РІР°РµС‚ `codex exec`.

Blocked behavior:

- РµСЃР»Рё `directExecution.enabled = false`, Р·Р°РїСѓСЃРє `codex exec` Р·Р°РїСЂРµС‰С‘РЅ;
- РІРѕР·РІСЂР°С‰Р°РµС‚СЃСЏ СЏСЃРЅС‹Р№ blocked/disabled result СЃ `fix_blocker`.
