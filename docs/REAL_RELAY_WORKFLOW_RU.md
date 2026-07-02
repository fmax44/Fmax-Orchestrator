# Real Relay Workflow

## 1. Что такое relay workflow

Цель relay workflow: убрать пользователя из роли курьера между окнами ChatGPT и Codex Desktop.

Целевая схема:

```text
Пользователь пишет идею в ChatGPT
→ ChatGPT создаёт задачу через Orchestrator
→ Codex берёт задачу из .codex/tasks
→ Codex делает изменения и пишет report
→ ChatGPT читает report через Orchestrator
→ ChatGPT запускает review_gate
→ ChatGPT approve/reject
→ Orchestrator обновляет state
→ пользователь получает результат
```

## 2. Как должна работать связка ChatGPT ↔ Orchestrator ↔ Codex

Нормальный поток выглядит так:

1. Пользователь пишет задачу в ChatGPT.
2. ChatGPT вызывает `create_task`.
3. Orchestrator создаёт `.codex/tasks/<id>-task.md` и обновляет `.codex/state/tasks.json`.
4. Codex открывает следующую pending task из очереди.
5. Codex вносит изменения и создаёт `.codex/reports/<id>-report.md`.
6. Orchestrator видит report и переводит задачу в `reported`.
7. ChatGPT вызывает `read_report`, `inspect_diff`, `run_tests` и `review_gate`.
8. ChatGPT вызывает `approve_task` или `reject_task`.
9. Если задача принята, следующим шагом остаётся commit и создание следующей задачи.

## 3. Что уже реализовано

- MCP tools уже есть: `create_task`, `get_task_status`, `read_report`, `inspect_diff`, `run_tests`, `review_gate`, `approve_task`, `reject_task`, `project_status`, `create_next_task`.
- Локальная файловая очередь уже есть: `.codex/tasks`, `.codex/reports`, `.codex/state/tasks.json`.
- `project_status` уже умел считать `recommendedAction`.
- Теперь `project_status` дополнительно показывает:
  - `currentTask`
  - `waitingFor`
  - `nextActor`
  - `nextAction`
- Добавлена CLI-команда `npm run relay:status -- --project "<path>"`.
- Добавлена CLI-команда `npm run codex:next -- --project "<path>"`.
- Добавлена автоматическая синхронизация: если для pending task появился report, Orchestrator переводит её в `reported`.

## 4. Чего раньше не хватало

- Не было явного ответа на вопрос: кто сейчас должен действовать.
- Не было удобного relay-статуса для ChatGPT, Codex и пользователя.
- Не было отдельной команды, которая готовит следующую pending task для Codex.
- Не было автоматической синхронизации `pending → reported` по факту появления report.
- Пользователь по-прежнему был вынужден вручную переносить путь к задаче и объяснять, что делать дальше.

## 5. Какие ручные действия остаются

Полностью автоматический relay пока всё ещё не достигнут.

Ручные шаги, которые остаются:

- пользователь всё ещё открывает ChatGPT и Codex Desktop как отдельные приложения;
- Codex Desktop нельзя штатно запустить или управлять им напрямую через этот CLI;
- ChatGPT не может изнутри этого репозитория гарантированно “толкнуть” задачу в уже открытый Codex Desktop session;
- commit остаётся отдельным осознанным шагом после approval.

## 6. Как эти ручные действия уменьшены

- ChatGPT больше не обязан описывать relay вручную: `project_status` и `relay:status` уже говорят, кто следующий actor.
- Codex больше не должен искать задачу руками по папкам: `codex:next` показывает next pending task, путь к файлу и ожидаемый report path.
- Если report уже создан, Orchestrator сам переводит задачу в `reported` при чтении статуса.
- Пользователь больше не должен копировать report из Codex в ChatGPT: ChatGPT читает его через `read_report`.

## 7. Может ли ChatGPT напрямую говорить с Orchestrator

Да, если текущий ChatGPT client подключён к локальному MCP server этого проекта.

Что реально подтверждено в коде:

- сервер MCP регистрирует нужные tools;
- tool handlers работают;
- `project_status` доступен как MCP tool;
- Review Gate, approve и read_report доступны через handlers и CLI.

Что нельзя честно гарантировать изнутри репозитория:

- что конкретное окно ChatGPT прямо сейчас подключено к этому локальному MCP server;
- что пользователь уже настроил MCP integration в своей среде ChatGPT;
- что ChatGPT может управлять Codex Desktop как внешним GUI-приложением.

Итог:

```text
ChatGPT ↔ Orchestrator: да, это поддерживается при подключённом MCP server.
ChatGPT ↔ Codex Desktop напрямую: нет, такого встроенного transport сейчас нет.
```

## 8. Может ли Codex автоматически подбирать задачи

Частично да.

Что реализовано:

- `npm run codex:next -- --project "<path>"` находит следующую pending task;
- показывает `taskPath`;
- показывает инструкцию для Codex;
- знает ожидаемый `reportPath`;
- умеет ждать появления report в `--watch` режиме;
- не делает approve автоматически.

Что не реализовано:

- Orchestrator не может сам “втолкнуть” задачу в уже открытый Codex Desktop;
- CLI не управляет GUI Codex Desktop и не запускает выполнение внутри него.

Итог:

```text
Nearest achievable automation:
Orchestrator выбирает следующую задачу и формирует relay-инструкцию.
Codex Desktop остаётся исполнителем, но старт выполнения всё ещё требует открытия/запуска со стороны пользователя или оператора.
```

## 9. Как проверить end-to-end workflow

На примере `D:\projects\orchestrator-product-trial`:

1. В ChatGPT создать задачу через `create_task`.
2. Проверить очередь:

```powershell
npm run relay:status -- --project "D:\projects\orchestrator-product-trial"
```

3. Подготовить задачу для Codex:

```powershell
npm run codex:next -- --project "D:\projects\orchestrator-product-trial"
```

4. Открыть указанный `taskPath` в Codex Desktop и выполнить задачу.
5. Создать report в ожидаемом `reportPath`.
6. Проверить relay снова:

```powershell
npm run relay:status -- --project "D:\projects\orchestrator-product-trial"
```

Ожидаемо состояние сменится с `Codex execution` на `ChatGPT review`.

7. В ChatGPT прочитать report через `read_report`.
8. Запустить:

```powershell
npm run review -- --project "D:\projects\orchestrator-product-trial" --task 0001 --write-report --checks "npm run build,npm run lint"
```

9. После `APPROVABLE` выполнить approve.
10. После approve проверить:

```powershell
npm run status -- --project "D:\projects\orchestrator-product-trial"
```

## 10. Как читать relay:status

Пример:

```text
Current relay state:

Project: orchestrator-product-trial
Current task: 0011
Task status: pending
Waiting for: Codex
Next actor: Codex
Next action: Open Codex Desktop and execute task 0011 from .codex/tasks/0011-task.md.
```

Или:

```text
Current relay state:

Project: orchestrator-product-trial
Current task: 0011
Task status: reported
Waiting for: ChatGPT review
Next actor: ChatGPT
Next action: Run review_gate for task 0011.
```

## 11. Ограничения ChatGPT и Codex Desktop

- ChatGPT может вызывать MCP tools только если локальный MCP server реально подключён в клиенте.
- ChatGPT не может гарантированно открывать или управлять Codex Desktop session напрямую.
- Codex Desktop не предоставляет в этом проекте headless relay API вида “выполни следующую задачу из очереди”.
- Orchestrator умеет координировать очередь, статус, report и review, но не заменяет transport между отдельными GUI-приложениями.

## 12. Итоговая рекомендация

Лучший достижимый MVP сейчас:

```text
ChatGPT создаёт и проверяет задачи через MCP tools.
Orchestrator хранит очередь и определяет следующего actor.
Codex получает задачу через codex:next и пишет report в .codex/reports.
Пользователь больше не копирует содержимое задач и отчётов между окнами.
```

Это ещё не “полный автопилот”, но это уже реальный relay workflow без ручного переноса основного текста.

## 13. Актуальный стабильный режим

После проверки autonomous Codex CLI workflow основным режимом снова считается manual Codex Desktop workflow:

- ChatGPT создаёт и проверяет задачи через MCP/tunnel.
- Orchestrator хранит `.codex/tasks`, `.codex/reports`, `.codex/state/tasks.json`, status, Review Gate и approve workflow.
- Codex Desktop выполняет задачу вручную по инструкции из `codex:next`.
- Codex Worker может оставаться watcher/report bridge, но не запускает Codex CLI по умолчанию.
- `codex:run-once` и `codex_autonomous_run` являются experimental opt-in и без явного разрешения не вызывают `codex exec`.
