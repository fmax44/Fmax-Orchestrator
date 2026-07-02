# Manual Codex Desktop Workflow

Этот документ фиксирует стабильную схему работы Fmax-Orchestrator после возврата от автономного Codex CLI workflow.

## Основная схема

```text
ChatGPT/MCP
-> .codex/tasks/<id>-task.md
-> Codex Desktop вручную выполняет задачу
-> .codex/reports/<id>-report.md
-> ChatGPT/MCP запускает Review Gate
-> approve/reject
-> commit/push только отдельным решением
```

## Роли

- ChatGPT через MCP/tunnel создаёт задачи, читает reports, смотрит diff, запускает проверки, Review Gate и approve/reject.
- Orchestrator хранит task queue, reports, decisions, status, `relay:status`, `codex:next`, Review Gate и approval workflow.
- Codex Desktop остаётся исполнителем: открывает task file, меняет код, пишет report.
- Пользователь принимает решения о commit/push/archive отдельно от выполнения задачи.

## Рабочий цикл

1. ChatGPT создаёт задачу через MCP tool `create_task` или локальный Orchestrator workflow.
2. Проверяется текущая точка relay:

```powershell
npm run relay:status -- --project "D:\projects\chatgpt-codex-mcp"
```

3. Для Codex Desktop подготавливается следующая pending task:

```powershell
npm run codex:next -- --project "D:\projects\chatgpt-codex-mcp"
```

4. Пользователь открывает Codex Desktop.
5. Codex Desktop читает `.codex/tasks/<id>-task.md`.
6. Codex Desktop выполняет только scoped task.
7. Codex Desktop создаёт `.codex/reports/<id>-report.md`.
8. ChatGPT/MCP запускает:

```powershell
npm run review -- --project "D:\projects\chatgpt-codex-mcp" --task <id> --write-report
```

9. Если Review Gate возвращает `APPROVABLE`, approval выполняется отдельным шагом.
10. Commit/push выполняются только после отдельного подтверждения пользователя.

## Codex Worker

Codex Worker остаётся optional watcher/report bridge. По умолчанию он не запускает Codex CLI и не должен плодить Codex/node процессы.

Если `directExecution` выключен, worker показывает `manual Codex Desktop mode`: он может найти pending task, подготовить инструкцию и ждать report, но не вызывает `codex exec`.

## Codex CLI direct execution

`npm run codex:run-once` и MCP tool `codex_autonomous_run` считаются experimental opt-in.

Без явного разрешения они не вызывают `codex exec`:

- CLI требует `--direct-execution`;
- MCP требует `allowDirectExecution=true`;
- config default остаётся `worker.directExecution.enabled=false`;
- `dry-run` никогда не вызывает `codex exec`.

Даже при включённом local config штатный workflow должен оставаться manual Codex Desktop, если запуск не был явно разрешён для конкретной команды.

## Dashboard

Dashboard остаётся панелью статуса и launcher для основных сервисов:

- tunnel/MCP являются основными рабочими элементами для ChatGPT;
- Codex Worker отображается как optional/manual, если direct execution выключен;
- отсутствие Codex CLI не должно выглядеть как critical failure основного workflow;
- карточка worker показывает компактную диагностику и не выводит длинные raw logs.

## Safety boundaries

- Не auto-approve.
- Не auto-commit.
- Не auto-push.
- Не auto-archive.
- Не использовать GUI automation, clipboard automation или управление окном Codex Desktop.
- Не трогать secrets, `.env`, local config и `CONTROL_PLANE_API_KEY` без отдельного разрешения.
- Не считать Codex CLI основным transport между ChatGPT и Codex Desktop.
