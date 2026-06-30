# MCP Direct Control Blockers

## Desired Outcome

ChatGPT должен сам вызывать tools Fmax-Orchestrator по MCP без ручного переноса текста пользователем.

## Current State

В `D:\projects\chatgpt-codex-mcp` есть рабочий локальный MCP server на `@modelcontextprotocol/sdk`.

Он:

- запускается локально;
- экспортирует critical tools, включая `project_status`, `review_gate`, `relay_status`, `codex_next`;
- проходит `npm run mcp:self-test`.

Но текущий transport сервера — только `stdio`.

## What Works

- Локальный MCP server существует.
- `tools/list` работает.
- `project_status` вызывается через MCP self-test.
- `relay_status` и `codex_next` теперь доступны как MCP tools.
- Orchestrator можно использовать локальными MCP-клиентами.

## What Does Not Work

- ChatGPT в этом чате не видит tools Fmax-Orchestrator автоматически.
- ChatGPT нельзя подключить напрямую к локальному `stdio` server без внешней конфигурации.
- Пользователь всё ещё не получает fully automatic direct control только за счёт текущего кода репозитория.

## Blocking Issue

Главный blocker не в отсутствии tools, а в способе подключения.

По актуальной документации OpenAI:

- ChatGPT Developer Mode ориентирован на remote MCP servers;
- поддерживаемые протоколы для ChatGPT connector: `SSE` и `streaming HTTP`;
- для подключения нужен HTTPS endpoint или Secure MCP Tunnel.

Следовательно, текущий `stdio`-only сервер не является прямым ChatGPT-consumable endpoint.

## Required External Setup

Нужно одно из двух:

1. Добавить в Orchestrator remote MCP transport и публиковать `/mcp` по HTTPS.
2. Оставить локальный сервер как есть, но подключить его к OpenAI через Secure MCP Tunnel.

## Exact User Action Needed

Минимально необходимое действие вне кода:

1. Включить ChatGPT Developer Mode.
2. Сделать MCP server доступным для ChatGPT через HTTPS endpoint или Secure MCP Tunnel.
3. Создать connector в ChatGPT через Settings -> Apps & Connectors -> Create.
4. Убедиться, что после Create/Refresh ChatGPT видит exported tools.

## Recommended Next Step

Ближайший достижимый вариант:

1. Не менять Product Trial.
2. Не строить большой production backend.
3. Добавить отдельный remote MCP wrapper для Fmax-Orchestrator или протестировать Secure MCP Tunnel поверх текущего сервера.
4. После этого выполнить реальный ChatGPT prompt-тест: `project_status` для `D:\projects\orchestrator-product-trial`.
