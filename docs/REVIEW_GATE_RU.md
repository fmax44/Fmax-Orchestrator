# Review Gate

## 1. Зачем нужен Review Gate

Review Gate собирает стандартную проверку перед `approve_task` в один шаг. Он уменьшает риск забыть проверить отчёт, diff, policy, forbidden paths или обязательные команды.

## 2. Что он проверяет

Review Gate проверяет:

- статус задачи;
- наличие отчёта Codex;
- текущий git diff;
- policy validation;
- forbidden tracked paths;
- protected files и manual approval;
- результаты переданных checks;
- security warnings.

## 3. Статусы APPROVABLE / NEEDS_REVIEW / BLOCKED

- `APPROVABLE` - задача может быть принята.
- `NEEDS_REVIEW` - есть warnings или manual approval required; нужен явный override.
- `BLOCKED` - есть blocking errors; approve запрещён без `force` и `forceReason`.

## 4. Как запустить через CLI

```powershell
npm run review -- --project "D:\projects\syscool-kb" --task 0001
npm run review -- --project "D:\projects\syscool-kb" --task 0001 --format json
npm run review -- --project "D:\projects\syscool-kb" --task 0001 --write-report
```

Дополнительные flags:

```powershell
npm run review -- --project "D:\projects\syscool-kb" --task 0001 --checks "git status --short,git diff --stat"
npm run review -- --project "D:\projects\syscool-kb" --task 0001 --no-require-report
```

## 5. Как использовать через MCP tool

Tool: `review_gate`.

```json
{
  "projectPath": "D:\\projects\\syscool-kb",
  "taskId": "0001",
  "checks": ["git status --short", "git diff --stat"],
  "writeReport": true
}
```

## 6. Как Review Gate связан с approve_task

`approve_task` автоматически запускает Review Gate.

- `APPROVABLE` - approve разрешён.
- `NEEDS_REVIEW` - approve разрешён только с `overrideReviewGate: true`.
- `BLOCKED` - approve запрещён, кроме `force: true` с непустым `forceReason`.

## 7. Когда можно override

Override допустим, когда Review Gate вернул `NEEDS_REVIEW`, а архитектор осознанно принял warnings: protected file, manual approval или нестандартный, но безопасный статус.

## 8. Когда нельзя approve

Без force нельзя approve, если:

- отсутствует обязательный report;
- изменён blockedPath;
- изменён `.env`;
- tracked `.codex`;
- есть forbidden tracked paths;
- required check failed;
- policy validation failed.

## 9. Пример для документационной задачи

Для docs-only задачи ожидаемый результат:

```text
Decision: APPROVABLE
Recommended action: approve_task
```

## 10. Пример для blockedPath

Если diff содержит `.env`, `.codex`, `storage/uploads/**`, `backups/**`, `dist/**` или другой `blockedPath`, ожидаемый результат:

```text
Decision: BLOCKED
Recommended action: reject_task
```

Force approval требует явного `forceReason`, который записывается в architect decisions.

## 11. Provenance и срок годности review

Если Review Gate запускается с `--write-report`, Orchestrator сохраняет provenance в `.codex/state/tasks.json`:

- `decision`
- `reviewReportPath`
- `reviewHash`
- `createdAt`
- `changedFiles`
- `warnings`
- `errors`

CLI JSON-ответ также содержит:

- `reviewHash`
- `reviewReportPath`
- `validUntil`

Это нужно для strict approve: approval опирается не на новый ad-hoc review, а на сохранённый проверенный результат.

## 12. Strict approve

В strict workflow `approve_task` и `npm run approve` не принимают задачу без валидного provenance.

- Missing provenance или missing report: `BLOCKED`.
- Hash mismatch: `BLOCKED`.
- Stale review: `NEEDS_REVIEW`.
- `overrideReviewGate` может пройти только `NEEDS_REVIEW`.
- `force` может пройти только `BLOCKED` и требует `forceReason`.

## 13. Проверка review через project status

Команда `status` показывает последнее Review Gate provenance без ручного чтения `.codex/state/tasks.json`:

```powershell
npm run status -- --project "D:\projects\syscool-kb"
```

В status видны:

- last decision;
- review hash;
- valid until;
- expired;
- recommendedAction.

Если strict review устарел, status вернёт `recommendedAction = rerun_review_gate`.
