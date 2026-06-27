# Пример цикла ChatGPT + Codex

## Шаг 1. Архитектор ставит задачу

ChatGPT вызывает `create_task`.

Пример входа:

```json
{
  "projectPath": "D:\\projects\\some-project",
  "title": "Initialize project",
  "goal": "Create initial TypeScript project",
  "scope": ["Create package.json", "Add tests"],
  "acceptanceCriteria": ["Build passes", "Tests pass"],
  "requiredChecks": ["npm run build", "npm test"]
}
```

## Шаг 2. Codex Desktop выполняет задачу

Codex читает `.codex/tasks/0001-task.md` и вносит изменения.

## Шаг 3. Codex пишет отчёт

Codex создаёт `.codex/reports/0001-report.md`.

## Шаг 4. ChatGPT проверяет

ChatGPT вызывает:

- `read_report`
- `inspect_diff`
- `run_tests`

## Шаг 5. Решение

Если всё хорошо:

- `approve_task`
- `create_next_task`

Если есть проблемы:

- `reject_task`
