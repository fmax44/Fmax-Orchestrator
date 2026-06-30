# Экран "Новое приложение" в ChatGPT для Fmax-Orchestrator

## Короткий ответ

Для текущего локального `D:\projects\chatgpt-codex-mcp` на Windows нужно выбирать:

- Подключение: `Туннель`
- Аутентификация: `Без аутентификации`

Не нужно выбирать `URL-адрес сервера`, потому что Fmax-Orchestrator сейчас не поднимает публичный HTTPS MCP endpoint. Он работает как локальный `stdio` MCP server, и для ChatGPT его нужно подключать через Secure MCP Tunnel.

## Что вводить на экране

### Название

```text
Fmax-Orchestrator
```

### Описание

```text
Локальный AI-оркестратор для управления задачами Codex, отчётами, Review Gate, Git-контролем и статусом проектов через MCP.
```

### Подключение

Выбрать:

```text
Туннель
```

Почему:

- официальная документация OpenAI для локальной разработки рекомендует Secure MCP Tunnel;
- для локального сервера на машине пользователя это правильный путь;
- `URL-адрес сервера` нужен только если у вас уже есть публичный HTTPS MCP endpoint.

### URL

Для варианта `Туннель` URL вручную вставлять не нужно.

Если экран сейчас показывает placeholder вроде:

```text
https://example.com/sse
```

это относится к режиму `URL-адрес сервера`, а не к tunnel flow.

Для текущего Fmax-Orchestrator правильный ответ:

```text
URL не используется, если выбран Туннель.
```

### Аутентификация

Выбрать:

```text
Без аутентификации
```

Почему:

- текущий сервер не реализует OAuth;
- по официальной документации ChatGPT Developer Mode поддерживает `OAuth`, `No Authentication` и `Mixed Authentication`;
- для dev-подключения к локальному Orchestrator OAuth сейчас не нужен.

Если UI по какой-то причине не даёт выбрать `Без аутентификации`, это уже не ограничение репозитория Fmax-Orchestrator, а ограничение или баг конкретного экрана/Workspace конфигурации ChatGPT.

## Что делать в PowerShell

## 1. Собрать Orchestrator

```powershell
cd D:\projects\chatgpt-codex-mcp
npm run build
```

## 2. Опционально задать default project для resources

Это не обязательно для tools, но полезно для статических resources.

```powershell
$env:CODEX_MCP_DEFAULT_PROJECT="D:\projects\orchestrator-product-trial"
```

## 3. Задать runtime API key для tunnel-client

Нужен runtime key с правами `Tunnels Read + Use`.

```powershell
$env:CONTROL_PLANE_API_KEY="REPLACE_WITH_RUNTIME_KEY"
```

## 4. Инициализировать tunnel-client профиль для локального stdio MCP

Сначала скачайте `tunnel-client.exe` из:

- [Platform Tunnels settings](https://platform.openai.com/settings/organization/tunnels)
- или [latest release](https://github.com/openai/tunnel-client/releases/latest)

`tunnel-client.exe` и распакованные release-папки являются локальными helper-артефактами для dev-setup. Их не нужно коммитить в репозиторий Fmax-Orchestrator.

Дальше, если бинарник лежит в текущей папке как `.\tunnel-client.exe`:

```powershell
.\tunnel-client.exe init --sample sample_mcp_stdio_local --profile local-stdio --tunnel-id tunnel_REPLACE_WITH_REAL_ID --mcp-command '"C:\Program Files\nodejs\node.exe" "D:\projects\chatgpt-codex-mcp\dist\index.js"'
```

## 5. Проверить профиль

```powershell
.\tunnel-client.exe doctor --profile local-stdio --explain
```

## 6. Запустить tunnel-client

```powershell
.\tunnel-client.exe run --profile local-stdio
```

Важно:

- этот процесс должен оставаться запущенным;
- ChatGPT не увидит tools, если `tunnel-client run ...` уже остановлен.

## Что нажимать в ChatGPT

После того как `tunnel-client` уже запущен:

1. Открыть `Settings -> Apps & Connectors -> Create`.
2. В поле `Название` вставить `Fmax-Orchestrator`.
3. В поле `Описание` вставить согласованный текст.
4. В блоке `Подключение` выбрать `Туннель`.
5. Выбрать tunnel из списка или вставить `tunnel_id`.
6. В блоке `Аутентификация` выбрать `Без аутентификации`.
7. Нажать `Create`.

Если всё подключено правильно, ChatGPT покажет список tools, которые сервер рекламирует.

## Какой endpoint реально используется

Для tunnel flow ChatGPT обращается не к `localhost` и не к URL, введённому вручную.

Реально используется:

- OpenAI-hosted MCP tunnel endpoint, связанный с вашим `tunnel_id`;
- локальный `tunnel-client`, который внутри Windows-машины проксирует вызовы в `node dist/index.js`.

Поэтому практическая схема такая:

```text
ChatGPT -> OpenAI-hosted tunnel endpoint -> tunnel-client -> local stdio MCP server
```

## Какие tools должны появиться

После успешного подключения ожидаются как минимум:

- `project_status`
- `relay_status`
- `codex_next`
- `create_task`
- `get_task_status`
- `read_report`
- `inspect_diff`
- `run_tests`
- `review_gate`
- `approve_task`
- `reject_task`
- `archive_task`

Также будут доступны дополнительные tools сервера:

- `create_next_task`
- `project_health`
- `list_tasks`
- `doctor`
- `smoke_check`
- `read_policy`
- `validate_task_against_policy`
- `validate_diff_against_policy`

## Первый тест

После `Create` и появления tools:

1. Открыть новый чат.
2. Подключить draft app `Fmax-Orchestrator`.
3. Написать:

```text
Проверь статус trial-проекта через Fmax-Orchestrator. Используй project_status для D:\projects\orchestrator-product-trial.
```

Ожидаемое поведение:

- ChatGPT сам вызывает `project_status`;
- в tool payload передаётся `projectPath = "D:\\projects\\orchestrator-product-trial"`;
- пользователь не копирует task/report вручную.

## Чего не делать

Не нужно сейчас:

- выбирать `URL-адрес сервера`;
- указывать `http://127.0.0.1/...`;
- пытаться прикрутить OAuth для dev-спайка;
- сохранять runtime key, admin key или любые секреты в репозитории.

## Если хочется именно URL-режим

Это уже другой путь.

Тогда нужно:

1. реализовать remote MCP endpoint в самом Orchestrator;
2. поднять его по HTTPS;
3. использовать public `/mcp` endpoint;
4. только после этого выбирать `URL-адрес сервера`.

Для текущего состояния репозитория это не минимальный путь.
