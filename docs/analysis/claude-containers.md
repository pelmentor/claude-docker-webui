# Анализ Claude Code контейнеров

Анализ двух референсов: **ClaudeBox** (`code-reference/claudebox/`) и **CodeG** (`code-reference/codeg/`).

---

## 1. Dockerfile

### ClaudeBox

| Параметр | Значение |
|----------|----------|
| Базовый образ | `debian:bookworm` |
| Стратегия | Два образа: `claudebox-core` (общий) + проектный (с профилями) |
| Размер | Core ~300MB, проектный +100-500MB |

**Оптимизация размера:**
- BuildKit cache mounts для `/var/cache/apt` и `/var/lib/apt` — пакеты кешируются между билдами
- Разделение core/project образов — core переиспользуется для всех проектов
- Ленивая загрузка инструментов — языковые рантаймы ставятся по профилям, не все сразу
- Python venv создаётся в entrypoint (не в Dockerfile) — изменения Python не триггерят полный ребилд
- Хеш профилей сохраняется в label образа — ребилд только при реальных изменениях

**Слои (порядок):**
1. Policy-RC.D blocker (предотвращает запуск демонов при билде)
2. Базовые пакеты: git, curl, sudo, vim, nano, zsh, jq, tmux и т.д.
3. Locale setup (en_US.UTF-8)
4. Пользователь с UID/GID от хоста
5. ZSH + Oh-my-zsh + fzf
6. uv (Python package manager)
7. NVM + Node.js
8. Claude Code (npm global install)
9. Terminal resize handling (TRAPWINCH, checkwinsize)
10. Tmux конфигурация

### CodeG

| Параметр | Значение |
|----------|----------|
| Базовый образ | Multi-stage: `node:22-alpine` → `rust:slim-bookworm` → `node:22-bookworm-slim` |
| Стратегия | Один production образ с компиляцией в отдельных стадиях |

**Слои runtime стадии:**
1. Runtime deps: libsqlite3, git, openssh-client, ca-certificates, curl, python3
2. Rust бинарник из build stage
3. Next.js static export из frontend stage

**Отличие от ClaudeBox:** CodeG — это standalone приложение (Rust + React), не обёртка над Claude Code.

---

## 2. Non-root пользователь

### ClaudeBox (рекомендуемый подход)

```dockerfile
ARG USER_ID GROUP_ID USERNAME
RUN groupadd -g $GROUP_ID $USERNAME || true && \
    useradd -m -u $USER_ID -g $GROUP_ID -s /bin/bash $USERNAME
```

**Почему UID/GID от хоста:**
- `--dangerously-skip-permissions` требует совпадения UID/GID для корректной работы с файлами
- Файлы в mounted volumes принадлежат хостовому пользователю
- Без совпадения — permission denied на чтение/запись рабочих файлов

**Sudo доступ:**
```dockerfile
RUN echo "claude ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/claude && \
    chmod 0440 /etc/sudoers.d/claude
```
- В entrypoint удаляется если `--enable-sudo` не передан
- По умолчанию безопасно: минимальные привилегии

### CodeG

Контейнер запускается от **root** — не используется non-root пользователь. Это антипаттерн для нашего случая.

### Вывод для нашего проекта

Используем подход ClaudeBox, но упрощённо — фиксированный UID/GID 1000:
```dockerfile
RUN groupadd -g 1000 claude && \
    useradd -m -u 1000 -g 1000 -s /bin/bash claude
RUN echo "claude ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/claude
```

---

## 3. Установка Claude Code

### ClaudeBox: npm через NVM (рекомендуемый)

```dockerfile
# Установка NVM
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
RUN bash -c "source $NVM_DIR/nvm.sh && nvm install --lts"

# Установка Claude Code
RUN bash -c "source $NVM_DIR/nvm.sh && nvm use default && \
    npm install -g @anthropic-ai/claude-code"
```

**Плюсы npm:**
- Управление версиями через NVM
- `claude update` работает нативно (npm update механизм)
- Глобальные пакеты автоматически в PATH через NVM
- Гибкость: можно поставить конкретную версию Node.js

**Минусы:**
- NVM добавляет ~50MB
- Нужно source NVM перед каждым использованием в entrypoint

### CodeG: не устанавливает Claude Code

CodeG — standalone приложение с собственным сервером, не использует Claude Code CLI.

### Вывод для нашего проекта

Используем **npm global install**, но без NVM — Node.js уже есть в `node:22-slim`:
```dockerfile
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
```
Это проще и легче. Node.js + npm уже в базовом образе, NVM не нужен.

---

## 4. Персистентность авторизации и конфигов

### ClaudeBox (продвинутый подход)

**Структура:**
```
~/.claudebox/projects/<slug>_<crc32>/
├── slot_1/
│   ├── .claude/          ← OAuth токены, сессии
│   ├── .config/          ← Конфиги инструментов
│   ├── .cache/           ← npm/pip кеши
│   └── .zsh_history      ← История шелла
├── slot_2/               ← Отдельный инстанс
└── profiles.ini          ← Общие настройки
```

**Mount'ы:**
```bash
-v "$PROJECT_SLOT_DIR/.claude":/home/claude/.claude    # Auth state
-v "$PROJECT_SLOT_DIR/.config":/home/claude/.config    # Tool configs
-v "$PROJECT_SLOT_DIR/.cache":/home/claude/.cache      # Caches
```

**Ключевые решения:**
- Per-slot изоляция (несколько Claude инстансов на проект)
- `.claude.json` монтируется только если уже существует (не перезаписывает fresh auth)
- Симлинки для shared данных (commands/)

### CodeG

- SQLite база в `/data` volume
- Token-based auth (не OAuth)
- Нет per-user изоляции

### Вывод для нашего проекта

Простой подход — один named volume для всего:
```yaml
volumes:
  - claude-auth:/home/claude/.claude    # Вся авторизация и конфиги
```
Слотовая система не нужна — у нас один пользователь.

---

## 5. Обновление Claude Code

### ClaudeBox

```bash
# В entrypoint при команде "update":
exec runuser -u claude -- bash -c '
    source $NVM_DIR/nvm.sh && nvm use default
    
    # Проверка stale lock (> 5 минут)
    lock_file="$HOME/.claude/.update.lock"
    if [[ -f "$lock_file" ]]; then
        lock_age=$(( $(date +%s) - $(stat ... "$lock_file") ))
        [[ $lock_age -gt 300 ]] && rm -f "$lock_file"
    fi
    
    # Обновление
    update_output=$(claude update 2>&1)
    echo "$update_output"
    
    # Верификация только при реальном обновлении
    if echo "$update_output" | grep -q "Successfully updated\|Installing update"; then
        claude --version
    fi
'
```

**Ключевые паттерны:**
- Stale lock detection (5 минут таймаут)
- Обновление от non-root (runuser -u claude)
- Верификация только при реальном обновлении
- NVM source перед любой командой

### Вывод для нашего проекта

Обновление через `npm update -g @anthropic-ai/claude-code`:
- При старте контейнера (в entrypoint)
- По кнопке "Update" в UI (через update.sh)
- При docker compose restart

---

## 6. Entrypoint (порядок инициализации)

### ClaudeBox

**Фазы:**
1. **Security:** export PATH, парсинг control flags
2. **Firewall:** init-firewall (soft failure — `|| true`)
3. **Sudo:** удаление sudoers если --enable-sudo не передан
4. **Python venv:** создание с atomic mkdir lock (конкурентная безопасность)
5. **Tooling.md:** генерация документации (по checksum профилей)
6. **Mode selection:** shell mode vs claude mode
7. **Claude exec:** source NVM → activate venv → sync commands → запуск claude

**Обработка ошибок:**
- `set -euo pipefail` — fail fast
- `|| true` только для ожидаемых ошибок (firewall, опциональные компоненты)
- Atomic mkdir lock для concurrent access
- Таймауты на ожидание (30 секунд максимум)

### Вывод для нашего проекта

Упрощённый entrypoint:
1. Установить пароль пользователя из $CLAUDE_PASSWORD
2. Проверить/обновить Claude Code
3. Проверить claude --version
4. Проверить /project mount
5. Запустить Node.js веб-сервер

---

## 7. Переменные окружения

### ClaudeBox (build-time)

| Переменная | Назначение |
|-----------|-----------|
| USER_ID | UID хоста (id -u) |
| GROUP_ID | GID хоста (id -g) |
| USERNAME | Имя пользователя (claude) |
| NODE_VERSION | Версия Node.js (--lts) |
| REBUILD_TIMESTAMP | Инвалидация кеша |

### ClaudeBox (runtime)

| Переменная | Назначение |
|-----------|-----------|
| LANG, LC_ALL | en_US.UTF-8 — корректный Unicode |
| SHELL | /bin/zsh |
| NVM_DIR | Путь к NVM |
| DEVCONTAINER | true — маркер контейнера |
| CLAUDEBOX_PROJECT_NAME | Имя проекта |
| VERBOSE | Debug output |

### CodeG (runtime)

| Переменная | Назначение |
|-----------|-----------|
| CODEG_PORT | HTTP порт (3080) |
| CODEG_HOST | Bind address (0.0.0.0) |
| CODEG_TOKEN | Auth токен |
| CODEG_DATA_DIR | SQLite директория |
| CODEG_STATIC_DIR | Static files |
| SHELL | /bin/bash |

### Вывод для нашего проекта

```dockerfile
ENV COLORTERM=truecolor
ENV TERM=xterm-256color
ENV LANG=en_US.UTF-8
ENV SHELL=/bin/bash
```

Runtime через docker-compose:
```yaml
environment:
  - CLAUDE_USER=claude
  - CLAUDE_PASSWORD=claude
```

---

## 8. Volume mounts

### ClaudeBox

| Mount | Назначение | Mode |
|-------|-----------|------|
| $PROJECT_DIR:/workspace | Рабочие файлы | rw |
| $SLOT/.claude:/home/claude/.claude | Auth state | rw |
| $SLOT/.config:/home/claude/.config | Tool configs | rw |
| $SLOT/.cache:/home/claude/.cache | Caches | rw |
| ~/.ssh:/home/claude/.ssh | SSH ключи | **ro** |
| .env:/workspace/.env | Секреты | **ro** |

**Паттерн:** Файлы которые не должны меняться — read-only.

### CodeG

| Mount | Назначение |
|-------|-----------|
| codeg-data:/data | SQLite база + user data |
| /path/to/projects:/projects | Опционально, рабочие файлы |

### Вывод для нашего проекта

```yaml
volumes:
  - /mnt/user/appdata/code-server/TTS_NEW:/project    # Рабочие файлы
  - claude-auth:/home/claude/.claude                    # Auth persistence
```

---

## 9. Лучшие практики (берём)

| Практика | Источник | Почему |
|---------|---------|--------|
| Non-root пользователь с UID 1000 | ClaudeBox | Безопасность + permission compatibility |
| npm global install Claude Code | ClaudeBox | Простое обновление, PATH интеграция |
| Named volume для .claude/ | ClaudeBox | Auth переживает пересоздание контейнера |
| set -euo pipefail в скриптах | ClaudeBox | Fail fast, нет тихих ошибок |
| Soft failures (|| true) для опциональных шагов | ClaudeBox | Контейнер стартует даже если обновление упало |
| Обновление при старте | ClaudeBox | Всегда актуальная версия |
| Версия в логах | ClaudeBox | Видно через docker logs |
| LANG=en_US.UTF-8 | ClaudeBox | Корректный Unicode |
| Healthcheck endpoint | CodeG | Мониторинг контейнера |
| restart: unless-stopped | CodeG | Автоперезапуск при краше |

---

## 10. Антипаттерны (избегаем)

| Антипаттерн | Источник | Почему плохо |
|------------|---------|-------------|
| Контейнер от root | CodeG | Уязвимость, permission issues с volumes |
| Нет cleanup apt cache | CodeG | Увеличивает размер образа |
| NVM для простого use-case | ClaudeBox | Overhead ~50MB, complexity при source |
| Слотовая система | ClaudeBox | Overkill для single-user |
| ZSH + Oh-my-zsh | ClaudeBox | Не нужно для headless контейнера |
| Profile/language system | ClaudeBox | Не нужно — только Claude Code |
| Tmux integration | ClaudeBox | WebSocket терминал заменяет tmux |
| Force rebuild every start | — | 5-10 минут лишнего ожидания |
| Hard-coded ports | CodeG | Гибкость через env vars |
| Парсинг флагов в нескольких местах | — | Дублирование, баги |
