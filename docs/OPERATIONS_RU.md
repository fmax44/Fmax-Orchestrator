# Эксплуатация MCP Orchestrator

## 1. Ежедневная проверка

Перед началом работы запустить:

```powershell
npm run doctor
```

Если работа идёт с конкретным проектом:

```powershell
npm run doctor -- --project "D:\projects\some-project"
```

## 2. Проверка нового проекта

1. Убедиться, что проект является Git-репозиторием.
2. Запустить bootstrap.
3. Запустить doctor по проекту.
4. Если doctor не показывает `NOT_READY`, можно создавать первую задачу.

## 3. Doctor

Doctor проверяет сам Orchestrator и, опционально, целевой проект.

Он подходит для быстрых ответов на вопросы:

- установлен ли Node.js/npm;
- есть ли нужные npm scripts;
- зарегистрированы ли MCP tools;
- читается ли Git;
- не трекаются ли запрещённые пути;
- готова ли `.codex`-структура проекта.

JSON-вывод:

```powershell
npm run doctor -- --format json
```

## 4. Smoke

Smoke проверяет рабочий цикл на целевом проекте без изменения бизнес-кода:

```powershell
npm run smoke -- --project "D:\projects\some-project"
```

### MVP-6: ephemeral smoke and Docker Compose profile

Для ежедневных проверок используйте ephemeral mode, чтобы smoke не расходовал обычные task IDs и не засорял рабочую очередь:

```powershell
npm run smoke -- --project "D:\projects\some-project" --ephemeral
```

Ephemeral smoke пишет служебные файлы только в `.codex/smoke/tasks`, `.codex/smoke/reports` и `.codex/smoke/state`. Обычные `.codex/state/tasks.json` и `.codex/tasks` не должны изменяться.

Для Docker Compose проектов используйте безопасный профиль:

```powershell
npm run doctor -- --project "D:\projects\some-project" --profile docker-compose
npm run smoke -- --project "D:\projects\some-project" --profile docker-compose --ephemeral
```

Профиль проверяет наличие compose-файла, доступность `docker compose version` и возможность выполнить `docker compose ps`. `docker compose config` по умолчанию не выполняется, потому что его вывод может содержать раскрытые env-значения.

Если нужно явно проверить `docker compose config`, используйте:

```powershell
npm run doctor -- --project "D:\projects\some-project" --profile docker-compose --allow-compose-config-output
```

Даже в этом режиме полный stdout/stderr не сохраняется в отчёты: фиксируются только pass/fail, exit code и предупреждение о возможных resolved env values.

Smoke создаёт служебную задачу, служебный отчёт, проверяет чтение отчёта, diff и чистый Git status. Все изменения остаются внутри `.codex`, который должен быть исключён из Git.

## 5. Что делать при NOT_READY

Исправить ошибки из секции `Errors`.

Типовые действия:

- инициализировать Git;
- запустить bootstrap;
- добавить `.codex/` в `.gitignore`;
- закоммитить ожидаемые изменения;
- добавить недостающие scripts в `package.json`.

## 6. Что делать при READY_WITH_WARNINGS

Warnings не всегда блокируют работу. Например, отсутствие `npm run lint` может быть допустимым для маленького проекта.

Перед началом задачи нужно явно решить, можно ли работать с такими предупреждениями.

## 7. Как проверять, что секреты не попали в Git

Использовать точную проверку:

```powershell
git ls-files | Select-String -Pattern '(^|/)(\.env$|node_modules/|dist/|\.codex/)'
```

Пустой вывод означает, что реальные `.env`, `node_modules`, `dist` и `.codex` не отслеживаются.

`.env.example` может быть в Git как безопасный шаблон.

## 8. Как безопасно запускать проверки

Использовать `run_tests` или smoke/doctor. Не запускать команды, которые читают секреты, удаляют файлы или скачивают код без явного решения.

## 9. Типовые ошибки

- Проект не является Git-репозиторием.
- `.codex/` не добавлен в `.gitignore`.
- Git status грязный перед началом задачи.
- Отчёт Codex не создан.
- Smoke запускается до bootstrap.
- В проекте нет build/test scripts.

## 10. Чек-лист перед началом работы

- `npm run doctor` прошёл.
- Для проекта `project_health` не показывает ошибок.
- Git status чистый.
- `.codex/` не трекается Git.
- Есть понятные build/test checks.
- Следующая задача маленькая и проверяемая.

## 11. Project policy

Для реальных проектов рекомендуется создать `.codex/project-policy.json`:

```powershell
npm run bootstrap -- --project "D:\projects\some-project" --policy basic
npm run bootstrap -- --project "D:\projects\some-node-project" --policy node
npm run bootstrap -- --project "D:\projects\syscool-kb" --policy docker-compose
```

Bootstrap не перезаписывает существующую policy без явного флага:

```powershell
npm run bootstrap -- --project "D:\projects\syscool-kb" --policy docker-compose --force-policy
```

Проверить policy:

```powershell
npm run policy -- --project "D:\projects\syscool-kb"
npm run policy -- --project "D:\projects\syscool-kb" --format json
```

Проверить задачу перед выдачей Codex:

```powershell
npm run policy -- --project "D:\projects\syscool-kb" --validate-task 0001
```

Проверить diff перед approve:

```powershell
npm run policy -- --project "D:\projects\syscool-kb" --validate-diff
```

Если есть policy, `create_task` проверяет `filesAllowed` и `requiredChecks`, а затем добавляет в markdown раздел `Policy Notes`. Smoke использует `defaultSmokeMode` и `defaultProfile` из policy, если флаги CLI не заданы явно.
