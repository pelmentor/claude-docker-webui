# Known Traps & Gotchas

Документация ловушек, обнаруженных при разработке. Каждая ловушка помечена комментарием `TRAP:` в коде.

---

## 1. libstdc++6 удаляется вместе с build-essential

**Файл:** `Dockerfile`

`node-pty` компилирует нативный `.node` аддон через `node-gyp` при `npm install`. Скомпилированный бинарник линкуется к `libstdc++6`. Если после компиляции сделать `apt-get purge build-essential && apt-get autoremove`, то `autoremove` может удалить `libstdc++6` как зависимость `g++`, и `node-pty` упадёт в рантайме с "error while loading shared libraries".

**Решение:** Перед purge явно поставить `apt-get install libstdc++6` чтобы пометить пакет как manually installed.

---

## 2. `su` без `-l` не сбрасывает HOME

**Файл:** `entrypoint.sh`

`su -s /bin/bash claude -c "..."` запускает команду от пользователя claude, но **не** меняет переменную `HOME` — она остаётся `/root`. Node.js процесс видит `process.env.HOME = '/root'`, и пакеты вроде `express-session` могут писать файлы в `/root` вместо `/home/claude`.

**Решение:** Явно экспортировать `HOME=/home/claude` в команде `su`.

Альтернатива: `su -l` (login shell), но это загружает `.profile`/`.bashrc` что может иметь побочные эффекты.

---

## 3. Race condition при kill/spawn терминала

**Файл:** `web/server.js`

При вызове `entry.pty.kill()` срабатывает `onExit` callback, который вызывает `terminals.delete(sessionId)`. Если новый терминал уже создан и записан в Map до того как `onExit` сработает — `delete` удалит **новый** терминал, а не старый.

**Решение:** Перед `kill()` отключить `onExit` через `removeAllListeners('exit')`. В `onExit` проверять `terminals.get(sessionId) === entry` перед удалением.

---

## 4. sessionMiddleware в WebSocket upgrade требует response object

**Файл:** `web/server.js`

`express-session` вызывает `res.setHeader()`, `res.end()` и т.д. на объекте response. При WebSocket upgrade нет объекта `ServerResponse`. Если передать `{}`, middleware упадёт когда попытается записать cookie (при создании новой сессии или обновлении expiry).

**Решение:** Передавать shim-объект: `{ getHeader() {}, setHeader() {}, end() {} }`.

Работает стабильно потому что `saveUninitialized: false` и `resave: false` — сессия read-only после логина.

---

## 5. GitHub Actions: build-push-action требует setup-buildx

**Файл:** `.github/workflows/docker.yml`

`docker/build-push-action@v4+` использует BuildKit/Buildx по умолчанию. Без предварительного шага `docker/setup-buildx-action` сборка падает с "buildx: not found".

**Решение:** Добавить `- uses: docker/setup-buildx-action@v3` перед `build-push-action`.

---

## 6. `claude auth status` может возвращать exit code 0 всегда

**Файл:** `scripts/connect.sh`

Команда `claude auth status` может возвращать 0 и при наличии, и при отсутствии авторизации. Разница только в тексте вывода. Использование `if claude auth status > /dev/null` всегда проходит — пользователь попадает в Claude без логина, и тот падает.

**Решение:** Парсить текст вывода: `claude auth status 2>&1 | grep -qi "logged in"`.

---

## 7. Нативный установщик Claude Code ставит бинарник в ~/.local/bin

**Файлы:** `entrypoint.sh`, `connect.sh`, `update.sh`, `server.js`

`curl https://claude.ai/install.sh | bash` ставит claude в `~/.local/bin/claude`, **не** в `~/.claude/local/bin/`. Путь не добавляется в PATH автоматически в non-interactive shells.

**Решение:** Во всех скриптах явно добавлять `export PATH="/home/claude/.local/bin:$PATH"`. В server.js использовать константу `CLAUDE_BIN` с полным путём.

---

## 8. Docker volumes монтируются с root ownership

**Файл:** `entrypoint.sh`

Named volumes (`claude-auth`, `claude-bin`) создаются Docker-ом с owner `root:root`. При первом запуске пользователь `claude` не может писать в `~/.claude` и `~/.local`. Установщик Claude Code падает с `EACCES: permission denied, mkdir`.

**Решение:** В entrypoint перед установкой: `chown claude:claude /home/claude/.claude /home/claude/.local`.

---

## 9. Установщик Claude Code использует bash-синтаксис

**Файл:** `entrypoint.sh`

Скрипт `https://claude.ai/install.sh` содержит bash-специфичный синтаксис (массивы и т.д.). Если запустить через `| sh` в Debian (где sh = dash), падает с `Syntax error: "(" unexpected`.

**Решение:** Всегда использовать `| bash`, не `| sh`.

---

## 10. node:22-slim уже содержит пользователя node с UID 1000

**Файл:** `Dockerfile`

Попытка создать пользователя `claude` с UID 1000 падает, потому что в образе `node:22-slim` уже есть пользователь `node` с этим UID.

**Решение:** `userdel -r node` перед `useradd`.
