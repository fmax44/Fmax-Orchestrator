# Project Status

## 1. Зачем нужна команда status

`status` даёт одну сводку по рабочему проекту: Git, policy, doctor readiness, очередь задач, последние отчёты, Review Gate provenance и рекомендуемое следующее действие.

## 2. Что она показывает

- Git repository status и список changed files.
- Project policy: profile, smoke mode, strict Review Gate.
- Doctor result и warnings.
- Количество задач по статусам.
- Последнюю задачу.
- Последний task report, review report и smoke report.
- Последнее Review Gate decision, hash, validUntil и expired.
- `recommendedAction`.

## 3. Как запустить

```powershell
npm run status -- --project "D:\projects\syscool-kb"
npm run status -- --project "D:\projects\syscool-kb" --format json
```

Дополнительные флаги:

- `--include-smoke`
- `--no-doctor`
- `--include-review`
- `--task 0001`

## 4. JSON output

JSON output предназначен для MCP clients и автоматических проверок:

```json
{
  "projectName": "syscool-kb",
  "git": {
    "status": "clean",
    "changedFiles": []
  },
  "policy": {
    "defaultProfile": "docker-compose",
    "defaultSmokeMode": "ephemeral",
    "strictReviewGate": true
  },
  "recommendedAction": "create_next_task"
}
```

## 5. Recommended action

`recommendedAction` помогает выбрать следующий шаг:

- `fix_blockers` - сначала исправить ошибки.
- `wait_for_codex_or_request_report` - есть pending task без отчёта.
- `run_review_gate` - отчёт есть, review provenance ещё нет.
- `rerun_review_gate` - strict review устарел.
- `approve_task` - Review Gate вернул `APPROVABLE`.
- `commit_changes` - task approved, но Git dirty.
- `create_next_task` - task approved и Git clean.
- `create_task` - задач пока нет.

## 6. Примеры

Текстовая сводка:

```powershell
npm run status -- --project "D:\projects\syscool-kb"
```

JSON:

```powershell
npm run status -- --project "D:\projects\syscool-kb" --format json
```

С запуском smoke:

```powershell
npm run status -- --project "D:\projects\syscool-kb" --include-smoke
```

## 7. Использование через MCP tool

Tool:

```text
project_status
```

Input:

```json
{
  "projectPath": "D:\\projects\\syscool-kb",
  "includeSmoke": false,
  "includeDoctor": true,
  "includeReview": true,
  "taskId": "0001"
}
```

Output совпадает с JSON output сервиса `projectStatus`.

## 8. Типовые статусы проекта

- Empty project: `recommendedAction = create_task`.
- Pending task without report: `recommendedAction = wait_for_codex_or_request_report`.
- Report exists but no review: `recommendedAction = run_review_gate`.
- Review is approvable: `recommendedAction = approve_task`.
- Approved task and dirty Git: `recommendedAction = commit_changes`.
- Approved task and clean Git: `recommendedAction = create_next_task`.
