# Project Policy

## 1. Зачем нужна политика проекта

Project policy фиксирует локальные правила безопасности для конкретного проекта. Она помогает Orchestrator понять, какие файлы можно менять, какие команды допустимы, какие зоны проекта приватные и когда требуется ручное подтверждение архитектора.

## 2. Где лежит policy-файл

Файл политики лежит внутри локальной рабочей области Orchestrator:

```text
.codex/project-policy.json
```

`.codex/` по умолчанию должен быть в `.gitignore`, поэтому policy является локальным operational-файлом и не попадает в Git без отдельного решения команды.

## 3. Основные поля

- `version` - версия schema, сейчас `1`.
- `projectName` - имя проекта.
- `defaultProfile` - профиль проверок по умолчанию, например `default` или `docker-compose`.
- `defaultSmokeMode` - `ephemeral` или `legacy`.
- `allowedPaths` - области, где обычные задачи могут менять файлы.
- `blockedPaths` - пути, которые запрещены независимо от `allowedPaths`.
- `protectedFiles` - файлы, которые можно менять только после ручного подтверждения.
- `allowedCommands` - безопасные команды.
- `blockedCommands` - запрещённые команды.
- `requiredChecks` - наборы обязательных проверок по типам задач.
- `sensitiveOutputCommands` - команды, вывод которых может содержать секреты.
- `manualApprovalRequiredFor` - пути, где всегда нужно ручное подтверждение.
- `privateFolders` - приватные папки проекта.

## 4. blockedPaths

`blockedPaths` важнее `allowedPaths`. Если файл одновременно попадает в allowed и blocked, задача или diff считаются нарушающими policy.

Типичные значения:

```json
[
  ".env",
  ".env.*",
  ".codex/**",
  "node_modules/**",
  "dist/**"
]
```

## 5. protectedFiles

`protectedFiles` не всегда блокируют задачу, но включают `manualApprovalRequired`.

Примеры:

```json
[
  "docker-compose.yml",
  "backend/alembic/**",
  "backend/migrations/**"
]
```

## 6. allowedCommands и blockedCommands

`blockedCommands` проверяются для `Required Checks` в задаче. Если команда начинается с запрещённого шаблона, задача невалидна.

Примеры запрещённых команд:

```json
[
  "docker compose config",
  "docker compose down -v",
  "rm -rf",
  "del /s",
  "format",
  "shutdown"
]
```

## 7. requiredChecks

`requiredChecks` описывает рекомендуемые проверки по типам задач.

Пример:

```json
{
  "docs": [
    "git status --short",
    "git diff --stat",
    "git diff --name-only"
  ],
  "docker-compose": [
    "docker compose ps"
  ]
}
```

## 8. manualApprovalRequiredFor

Это список путей, где нужен отдельный архитектурный approval даже если задача технически валидна.

Примеры:

```json
[
  "docker-compose.yml",
  ".env*",
  "storage/**",
  "backups/**"
]
```

## 9. Пример для Node-проекта

Создать policy:

```powershell
npm run bootstrap -- --project "D:\projects\some-node-project" --policy node
```

Node preset разрешает типичные файлы `src/**`, `tests/**`, `package.json`, `package-lock.json`, `tsconfig.json` и команды `npm run build`, `npm test`, `npm run lint`.

## 10. Пример для Docker Compose проекта

Создать policy:

```powershell
npm run bootstrap -- --project "D:\projects\syscool-kb" --policy docker-compose
```

Docker Compose preset использует:

- `defaultProfile: "docker-compose"`;
- `defaultSmokeMode: "ephemeral"`;
- запрет на `.env`, `storage/uploads/**`, `backups/**`, `.codex/**`;
- запрет на сохранение `docker compose config` output по умолчанию.

## 11. Как проверить задачу

Через CLI:

```powershell
npm run policy -- --project "D:\projects\syscool-kb" --validate-task 0001
```

Через MCP tool:

```json
{
  "projectPath": "D:\\projects\\syscool-kb",
  "taskId": "0001"
}
```

Tool: `validate_task_against_policy`.

## 12. Как проверить diff

Через CLI:

```powershell
npm run policy -- --project "D:\projects\syscool-kb" --validate-diff
```

Через MCP tool:

```json
{
  "projectPath": "D:\\projects\\syscool-kb"
}
```

Tool: `validate_diff_against_policy`.

## 13. Рекомендации для syscool-kb

Для `syscool-kb` использовать preset `docker-compose`.

Рекомендуемые правила:

- `.env` не читать и не менять.
- `storage/uploads/**` не трогать.
- `storage/smoke-tests/**` не трогать.
- `backups/**` не трогать.
- `docker compose config` не запускать без явного решения.
- Для обычной проверки использовать ephemeral smoke.
- Для документационных задач ограничивать `Files Allowed` значениями `docs/**` и `README.md`.
- Для изменений `docker-compose.yml`, миграций и storage всегда требовать ручной approval.
