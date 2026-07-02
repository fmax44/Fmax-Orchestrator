# No Manual Copy Workflow

## 1. Что меняется для пользователя

Когда relay workflow готов, пользователь больше не должен быть основным переносчиком текста между ChatGPT и Codex Desktop.

Пользователь больше не копирует:

- текст задачи из ChatGPT в Codex;
- текст отчёта из Codex обратно в ChatGPT;
- “кто сейчас должен действовать”.

## 2. Новый рабочий сценарий

1. Пользователь пишет задачу в ChatGPT.
2. ChatGPT создаёт задачу через MCP tool `create_task`.
3. Пользователь не копирует задачу в Codex вручную.
4. Codex берёт задачу из очереди через `npm run codex:next -- --project "<path>"`.
5. Codex выполняет задачу и пишет report в `.codex/reports`.
6. ChatGPT читает report через `read_report`.
7. ChatGPT запускает `review_gate`.
8. ChatGPT делает `approve_task` или `reject_task`.
9. Пользователь получает только итог, вопросы и следующий понятный шаг.

## 3. Что делает ChatGPT

ChatGPT отвечает за:

- постановку задачи;
- создание task через `create_task`;
- чтение report через `read_report`;
- запуск `inspect_diff`, `run_tests`, `review_gate`;
- принятие решения через `approve_task` или `reject_task`;
- создание следующей задачи через `create_next_task`.

## 4. Что делает Codex

Codex отвечает за:

- взять следующую pending task;
- выполнить задачу в коде;
- создать report;
- остановиться без автоматического approve.

## 5. Что делает Orchestrator

Orchestrator отвечает за:

- очередь задач в `.codex/tasks`;
- хранение report в `.codex/reports`;
- хранение state в `.codex/state/tasks.json`;
- определение `waitingFor`, `nextActor`, `nextAction`;
- синхронизацию `pending → reported`, если report уже создан;
- Review Gate и approval flow.

## 6. Какие команды использовать

Проверить, кто сейчас должен действовать:

```powershell
npm run relay:status -- --project "D:\projects\orchestrator-product-trial"
```

Подготовить следующую задачу для Codex:

```powershell
npm run codex:next -- --project "D:\projects\orchestrator-product-trial"
```

Полная status-сводка:

```powershell
npm run status -- --project "D:\projects\orchestrator-product-trial"
```

## 7. Что пользователь всё ещё делает сам

Пока остаются только эти ручные шаги:

- открыть ChatGPT;
- открыть Codex Desktop;
- запустить команду `codex:next` или передать её оператору;
- при необходимости сделать финальный commit после approval.

Но пользователь больше не обязан переносить сами задачи и отчёты между окнами.

## 8. Честное ограничение

Relay workflow не означает, что ChatGPT уже умеет напрямую управлять GUI Codex Desktop.

Текущий реалистичный вариант такой:

```text
ChatGPT управляет задачами и review через Orchestrator.
Codex выполняет задачу из файловой очереди.
Orchestrator связывает их через state, task files и reports.
```

Это и есть ближайший достижимый вариант без ручного копирования основного текста.

## 9. Что не автоматизируем по умолчанию

Codex CLI direct execution больше не считается основным путём. Он остаётся экспериментальным opt-in режимом для отдельной проверки, но штатный сценарий не должен запускать `codex exec` автоматически.

Для стабильной работы используйте:

- `relay:status` и MCP tools для постановки/проверки задач;
- `codex:next` для выбора следующей pending task и инструкции для Codex Desktop;
- ручное выполнение задачи в Codex Desktop;
- report в `.codex/reports`;
- Review Gate и approve после проверки.
