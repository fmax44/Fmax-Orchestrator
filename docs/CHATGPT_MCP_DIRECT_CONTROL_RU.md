# Прямое управление Fmax-Orchestrator из ChatGPT через MCP

## Что такое direct control

Direct control в контексте Fmax-Orchestrator означает, что пользователь пишет запрос в ChatGPT, а ChatGPT сам вызывает MCP tools Orchestrator без ручного копирования текста между окнами.

Целевой минимальный сценарий:

1. Пользователь пишет: "Проверь статус trial-проекта".
2. ChatGPT сам вызывает `project_status`.
3. ChatGPT получает JSON-ответ от Orchestrator.
4. ChatGPT отвечает пользователю на основе tool output.

## Почему это центральная идея продукта

Если ChatGPT не может сам вызывать MCP tools Orchestrator, пользователь остаётся ручным relay-между ChatGPT и Codex. Это снижает ценность продукта и ломает целевую схему orchestration.

## Какой MCP server уже есть

В `D:\projects\chatgpt-codex-mcp` уже есть реальный MCP server.

Точка входа:

- `src/index.ts`
- `src/mcp/server.ts`

Сервер собирается в `dist/index.js` и регистрирует tools, resources и prompts через `@modelcontextprotocol/sdk`.

## Как его запускать

Основные варианты:

- `npm run dev`
- `npm run build`
- `npm run start`

Фактическая stdio-команда после сборки:

```powershell
node dist/index.js
```

Для конфигурации MCP-клиента используйте именно прямой запуск `node dist/index.js`.
Не используйте `npm run dev` или `npm start` как stdio launcher: npm/tsx могут
напечатать служебный текст в stdout до ответа `initialize`, из-за чего клиент
увидит `invalid MCP initialize response`. В runtime stdout зарезервирован для
MCP JSON-RPC, а обычные console-сообщения перенаправляются в stderr.

Долгие проверки должны задавать достаточный `timeoutMs`. Если deadline команды
истёк, `run_tests` возвращает structured result с `timedOut: true` и exit code
`124`; `review_gate` преобразует это в structured `BLOCKED`, не обрывая MCP
transport. При отмене запроса клиентом сигнал передаётся subprocess, чтобы он не
оставался висеть.

## Какой transport используется сейчас

Сейчас сервер работает через `StdioServerTransport`.

Это означает:

- локальные MCP-клиенты могут подключаться по `stdio`;
- текущий сервер не поднимает публичный `/mcp` endpoint сам по себе;
- ChatGPT connector не сможет подключиться к нему напрямую как к удалённому MCP server без дополнительного слоя.

## Какие tools экспортируются

После Task 0015 сервер экспортирует:

- `create_task`
- `get_task_status`
- `read_report`
- `inspect_diff`
- `run_tests`
- `approve_task`
- `reject_task`
- `create_next_task`
- `relay_status`
- `codex_next`
- `project_health`
- `list_tasks`
- `archive_task`
- `doctor`
- `smoke_check`
- `read_policy`
- `validate_task_against_policy`
- `validate_diff_against_policy`
- `review_gate`
- `project_status`

## Что было добавлено в Task 0015

Были добавлены missing MCP wrappers для:

- `relay_status`
- `codex_next`

Также добавлена команда:

```powershell
npm run mcp:self-test
```

Она проверяет:

- запуск локального MCP server;
- `tools/list`;
- вызов `project_status`;
- вызов `create_task`;
- вызов `codex_next`;
- вызов `relay_status`;
- вызов `read_report`.

## Как проверить сервер локально

Быстрая проверка:

```powershell
cd D:\projects\chatgpt-codex-mcp
npm run build
npm run mcp:self-test -- --project "D:\projects\orchestrator-product-trial"
```

Ожидаемый результат:

- self-test проходит успешно;
- `project_status` callable через MCP;
- `relay_status` и `codex_next` видны в exported tools.

## Как проверить через MCP Inspector

Практический способ:

1. Запустить сервер локально.
2. Подключить MCP Inspector или другой MCP client к stdio-команде `node dist/index.js`.
3. Убедиться, что `tools/list` возвращает ожидаемый список.
4. Вызвать `project_status` для `D:\projects\orchestrator-product-trial`.

Внутри репозитория эту же идею покрывает `npm run mcp:self-test`.

## Как подключать к ChatGPT

По актуальной документации OpenAI, ChatGPT Developer Mode создаёт app/connector для remote MCP server, а не для локального stdio-процесса.

Практически это означает:

1. Нужен remote-compatible MCP endpoint.
2. Он должен быть доступен по HTTPS.
3. Для локальной разработки можно использовать Secure MCP Tunnel или внешний tunnel вроде ngrok/Cloudflare Tunnel.
4. После этого connector создаётся в ChatGPT через Settings -> Apps & Connectors -> Create.

Полезные официальные ссылки:

- [ChatGPT Developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
- [Connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)
- [MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

## Что должно появиться в ChatGPT

После корректного внешнего подключения:

1. В ChatGPT появляется draft app / connector.
2. ChatGPT видит список exported tools.
3. В диалоге можно явно просить использовать `project_status`, `create_task`, `review_gate` и другие инструменты.

## Первый end-to-end test

Рекомендуемый первый тест:

1. Поднять remote-compatible MCP endpoint для этого репозитория.
2. Добавить connector в ChatGPT Developer Mode.
3. В новом чате написать: "Use the Fmax-Orchestrator app and run project_status for D:\\projects\\orchestrator-product-trial".
4. Убедиться, что ChatGPT не просит вручную копировать task/report, а реально вызывает tool.

## Если ChatGPT не видит tools

Проверять в таком порядке:

1. Сервер действительно отвечает по HTTPS `/mcp`, а не только по `stdio`.
2. Connector создан именно в ChatGPT Developer Mode.
3. В connector виден список tools после refresh.
4. MCP endpoint доступен извне или через Secure MCP Tunnel.
5. Если используется auth, схема совместима с требованиями ChatGPT connector.

## Честный вывод

Fmax-Orchestrator уже готов как локальный MCP server и теперь экспортирует критические relay tools. Но прямое использование из ChatGPT "как есть" пока не достигается, потому что текущая реализация stdio-only, а ChatGPT ожидает remote MCP setup через HTTPS/SSE/streaming HTTP или tunnel.
