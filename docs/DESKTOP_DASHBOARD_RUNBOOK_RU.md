# Fmax-Orchestrator Desktop Dashboard Runbook

## Что это

`Fmax-Orchestrator` можно запускать как локальный desktop launcher:

1. ярлык на рабочем столе открывает dashboard;
2. dashboard показывает состояние VPN, tunnel, MCP, IP и управляемых проектов;
3. из dashboard можно открыть ChatGPT, Codex Desktop и локальный config;
4. dashboard не делает approve автоматически и не хранит реальные секреты в репозитории.

## Один раз настроить на Windows

1. Откройте `D:\projects\chatgpt-codex-mcp`.
2. Запустите:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1
```

3. Скопируйте пример конфига:

```powershell
Copy-Item .\scripts\fmax-orchestrator.config.example.json .\scripts\fmax-orchestrator.config.local.json
```

4. В `scripts\fmax-orchestrator.config.local.json` заполните локальные пути:
   - `apps.browserPath`
   - `apps.codexPath`
   - `apps.vpnPath`
   - `commands.tunnel.command`
   - `commands.tunnel.env.CONTROL_PLANE_API_KEY`
   - при необходимости список `managedProjects`

## Что делать при каждом новом запуске Windows / ChatGPT

1. Запустите ярлык `Fmax-Orchestrator` с рабочего стола.
2. Убедитесь, что dashboard открылся по адресу `http://127.0.0.1:47821/` или по порту из local config.
3. Кнопки в dashboard идут в рабочем порядке:
   - `Открыть VPN`
   - `Запустить Tunnel`
   - `Запустить MCP`
   - `Открыть ChatGPT`
   - `Открыть Codex`
   - `Открыть конфиг`
4. Если нужен VPN, сначала нажмите `Открыть VPN`.
5. Проверьте карточку `Tunnel`:
   - если статус `онлайн`, tunnel уже готов;
   - если статус `не в сети` или `ручной`, нажмите `Запустить Tunnel` или запустите tunnel вручную.
6. Проверьте карточку `MCP`:
   - для stdio-режима допустим статус `ручной`, если отдельный HTTP health-check не настроен;
   - нажмите `Запустить MCP`, если нужен отдельный локальный запуск.
7. Нажмите `Открыть ChatGPT`.
8. Нажмите `Открыть Codex`, если нужно исполнять pending task.
9. В новом чате ChatGPT попросите проверить статус проекта через Fmax-Orchestrator.

## Что видно в блоке IP

- локальные IPv4-адреса;
- публичный IP, если он доступен;
- город и страна, если геолокация определилась;
- безопасный fallback, если lookup недоступен офлайн, через VPN или по таймауту.

## Как это работает в новом чате ChatGPT

Целевой поток:

1. пользователь запускает dashboard;
2. dashboard помогает поднять VPN, tunnel и MCP;
3. пользователь открывает ChatGPT;
4. в чате выбирается подключённый `Fmax-Orchestrator`;
5. ChatGPT сам вызывает `project_status`, `relay_status`, `codex_next`, `review_gate` и другие MCP tools;
6. пользователь больше не копирует task/report между окнами как основной transport layer.

## Как работать с задачами

1. Для нового проекта сначала проверьте карточку проекта в dashboard.
2. Если `Следующий исполнитель = chatgpt`, действуйте из ChatGPT через MCP tools.
3. Если `Следующий исполнитель = codex`, откройте Codex Desktop и выполните task.
4. Если `Ожидание = user`, сначала устраните blocker: dirty git, doctor `NOT_READY`, missing policy или аналогичную проблему.

## Как подключить новый локальный проект

1. Bootstrap проекта должен быть уже выполнен.
2. Добавьте проект в `managedProjects` внутри `scripts\fmax-orchestrator.config.local.json`:

```json
{
  "name": "my-project",
  "path": "D:/projects/my-project"
}
```

3. Сохраните файл и обновите dashboard в браузере.
4. Проверьте, что карточка проекта показывает `Рекомендуемое действие`, `Ожидание`, `Следующий исполнитель` и `Следующий шаг`.

## Что остаётся ручным

- Выбор MCP app в новом чате ChatGPT, если UI ChatGPT не подхватил его автоматически.
- Ввод реального `CONTROL_PLANE_API_KEY` только в локальный config.
- Первичная настройка путей до Codex Desktop, VPN и tunnel-client.

## Безопасность

- `scripts\fmax-orchestrator.config.local.json` игнорируется Git.
- Реальные ключи и локальные бинарники tunnel не должны коммититься.
- Dashboard только открывает приложения и показывает статус; approve/reject по задачам остаются в workflow Orchestrator.
