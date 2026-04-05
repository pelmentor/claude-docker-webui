# Итоговая архитектура Claude Code Docker

Сводный документ на основе анализа трёх референсов.

---

## 1. Схема компонентов

```
┌─────────────────────────────────────────────────────┐
│                  Docker Container                    │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Node.js Web Server (:7681)          │   │
│  │                                               │   │
│  │  ┌─────────────┐    ┌─────────────────────┐  │   │
│  │  │   Express    │    │    WebSocket (ws)    │  │   │
│  │  │   - Auth     │    │    - Terminal I/O    │  │   │
│  │  │   - Static   │    │    - Resize events   │  │   │
│  │  │   - API      │    │    - Keepalive ping   │  │   │
│  │  └─────────────┘    └────────┬────────────┘  │   │
│  │                              │                │   │
│  │                         ┌────▼────┐           │   │
│  │                         │ node-pty │           │   │
│  │                         └────┬────┘           │   │
│  └──────────────────────────────┼────────────────┘   │
│                                 │                     │
│                          ┌──────▼──────┐              │
│                          │ connect.sh  │              │
│                          │ (user:claude)│              │
│                          └──────┬──────┘              │
│                                 │                     │
│                     ┌───────────▼───────────┐         │
│                     │     Claude Code CLI    │         │
│                     │ --dangerously-skip-    │         │
│                     │    permissions         │         │
│                     └───────────┬───────────┘         │
│                                 │                     │
│  Volumes:                       │                     │
│  /project ← рабочие файлы      │                     │
│  /home/claude/.claude ← auth    │                     │
└─────────────────────────────────┼─────────────────────┘
                                  │
                            Mounted from host
```

---

## 2. Что берём из каждого референса

### Из ClaudeBox (claudebox/)

| Решение | Почему берём |
|---------|-------------|
| Non-root пользователь (UID 1000) | Безопасность, permissions на volumes |
| npm install Claude Code | Простое обновление, PATH integration |
| Named volume для .claude/ | Auth переживает пересоздание контейнера |
| set -euo pipefail | Fail fast в скриптах |
| Soft failures для обновления | Контейнер стартует даже если update упал |
| Обновление при старте | Всегда актуальная версия |
| LANG=en_US.UTF-8 | Корректный Unicode |
| TERM=xterm-256color | Цвета в терминале |
| sudoers NOPASSWD | Claude Code может использовать sudo |

### Из CodeG (codeg/)

| Решение | Почему берём |
|---------|-------------|
| node:22-slim как базовый образ | Node.js из коробки, npm есть |
| Healthcheck endpoint | Мониторинг через docker |
| restart: unless-stopped | Автоперезапуск |
| EXPOSE + named volume | Явная декларация портов и данных |
| Environment variables для конфига | Без конфиг файлов |

### Из WG-Nginx Panel (pelican-wg-nginx/)

| Решение | Почему берём |
|---------|-------------|
| xterm.js тема (Material-like) | Проверенная палитра |
| FitAddon + resize handling | Авто-подстройка терминала |
| WebSocket reconnect strategy | Мобильная надёжность |
| Toast notification system | UX без alert() |
| Тёмная тема (panel colors) | Готовая палитра |
| Responsive sidebar toggle | Mobile pattern |
| Animated status indicator | Визуальный feedback |
| Keyboard shortcuts handler | Ctrl+C copy в терминале |
| CSS для scrollbar и terminal | Полированный UI |

---

## 3. Что отвергаем и почему

| Решение | Источник | Почему отвергаем |
|---------|---------|-----------------|
| NVM для Node.js | ClaudeBox | node:22-slim уже содержит Node.js |
| Debian bookworm базовый образ | ClaudeBox | node:22-slim легче и уже имеет Node |
| Слотовая система (multi-instance) | ClaudeBox | Single-user, один терминал |
| ZSH + Oh-my-zsh | ClaudeBox | Не нужно для headless контейнера |
| Profile/language system | ClaudeBox | Только Claude Code, без dev tools |
| Tmux integration | ClaudeBox | WebSocket терминал заменяет tmux |
| Firewall/network isolation | ClaudeBox | Overkill для домашнего Unraid |
| Запуск от root | CodeG | Небезопасно |
| Rust backend | CodeG | Overkill, Node.js достаточен |
| PHP backend | WG-Nginx | Node.js для всего (SSR не нужен) |
| Nginx proxy | WG-Nginx | Node.js сам раздаёт статику и WS |
| CSRF protection | WG-Nginx | SameSite cookie достаточен |
| Role-based permissions | WG-Nginx | Один пользователь |
| Rate limiting | WG-Nginx | Private network |
| HTTP polling fallback | WG-Nginx | WebSocket only (node-pty) |
| PHP sessions | WG-Nginx | Express sessions |

---

## 4. Стек технологий

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Runtime | Node.js | 22 LTS |
| HTTP сервер | Express | 4.x |
| WebSocket | ws | 8.x |
| PTY | node-pty | 1.x |
| Terminal (frontend) | xterm.js | 5.x |
| Terminal resize | @xterm/addon-fit | 0.10.x |
| Terminal links | @xterm/addon-web-links | 0.11.x |
| Session | express-session | 1.x |
| Container | Docker | - |
| Base image | node:22-slim | - |
| AI Tool | Claude Code | latest |

**Без Tailwind** — CSS написан вручную для минимального размера. Tailwind CDN тяжёлый (~300KB).

---

## 5. Структура файлов проекта

```
claude-docker/
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh
├── web/
│   ├── server.js              # Express + WebSocket + node-pty
│   ├── package.json
│   ├── public/
│   │   ├── index.html         # SPA (terminal page)
│   │   ├── login.html         # Login page
│   │   ├── manifest.json      # PWA manifest
│   │   ├── sw.js              # Service worker (offline/PWA)
│   │   ├── icon-192.png       # PWA icon
│   │   ├── icon-512.png       # PWA icon
│   │   ├── css/
│   │   │   └── style.css      # Все стили
│   │   └── js/
│   │       ├── terminal.js    # xterm.js init, WebSocket, resize
│   │       ├── ui.js          # Header, buttons, status bar
│   │       ├── mobile.js      # Touch events, extra keys, PWA
│   │       └── toast.js       # Toast notifications
│   └── views/                 # (пусто — всё через static HTML)
├── scripts/
│   ├── connect.sh             # Запуск Claude Code
│   └── update.sh              # Обновление Claude Code
└── docs/
    └── analysis/              # Документация анализа
```

---

## 6. Порядок запуска контейнера

```
docker compose up
        │
        ▼
┌─ entrypoint.sh ─────────────────────────────┐
│                                              │
│  1. echo $CLAUDE_PASSWORD | chpasswd         │
│     └─ Установить пароль пользователя        │
│                                              │
│  2. su - claude -c "npm update -g ..."       │
│     ├─ Текущая версия → stdout               │
│     ├─ Обновление                            │
│     ├─ Если успешно → новая версия           │
│     ├─ Если уже latest → "Already latest"    │
│     ├─ Если ошибка → WARNING (не fatal)      │
│     └─ Лог → /home/claude/.claude/update.log │
│                                              │
│  3. claude --version                          │
│     └─ Проверка что CLI работает             │
│                                              │
│  4. ls /project/                              │
│     └─ Проверка что volume примонтирован     │
│                                              │
│  5. cd /home/claude/web && node server.js    │
│     └─ Запуск веб-панели от user claude      │
│                                              │
└──────────────────────────────────────────────┘
        │
        ▼
┌─ Node.js server (:7681) ─────────────────────┐
│                                               │
│  Express routes:                              │
│    GET  /          → index.html (terminal)    │
│    GET  /login     → login.html               │
│    POST /login     → auth check → redirect    │
│    GET  /logout    → destroy session           │
│    GET  /api/status → version, uptime, etc    │
│    POST /api/restart → kill & respawn pty     │
│    POST /api/update  → run update.sh in pty   │
│    POST /api/new-session → respawn claude     │
│                                               │
│  WebSocket /ws:                               │
│    Auth check (session cookie)                │
│    Spawn node-pty → connect.sh                │
│    Bidirectional data: xterm ↔ pty            │
│    Resize events: { type: 'resize', cols, rows }│
│    Ping/pong каждые 30s                       │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 7. Диаграмма потока

### Первый запуск (auth)

```
Телефон (браузер)
    │
    ▼
GET http://unraid-ip:7681/
    │
    ▼
[Auth middleware] → Нет сессии → Redirect /login
    │
    ▼
Страница логина (тёмная, centered)
    │ username: claude
    │ password: claude
    ▼
POST /login
    │
    ▼
[Сервер] username === CLAUDE_USER && password === CLAUDE_PASSWORD
    │
    ▼ Успех → Set-Cookie: session
    │
Redirect /
    │
    ▼
index.html загрузился
    │
    ▼
[JS] new WebSocket('ws://unraid-ip:7681/ws')
    │
    ▼
[Сервер] Проверка session cookie → OK
    │
    ▼
[Сервер] spawn node-pty → /home/claude/connect.sh
    │
    ▼
[connect.sh] claude auth check
    ├── Не залогинен → claude login (в терминале)
    └── Залогинен → cd /project && claude --dangerously-skip-permissions
    │
    ▼
Claude Code работает в xterm.js через WebSocket
```

### Ежедневная работа

```
Телефон → http://unraid-ip:7681/
    │
    ▼
Cookie есть → index.html → WebSocket → terminal
    │
    ▼
Claude Code готов к работе
```

### Обрыв соединения

```
WebSocket onclose
    │
    ▼
Статус: "Reconnecting (1/5)..." (жёлтый)
    │
    ▼ через 1-5 секунд
    │
Новый WebSocket → если OK:
    ├── Статус: "Connected" (зелёный)
    └── Claude Code продолжает работу (сессия жива в контейнере)
    │
    ▼ если 5 попыток неудачно:
    │
Статус: "Disconnected" (красный) + кнопка "Reconnect"
```

### Выход из Claude (/exit)

```
Claude Code → exit
    │
    ▼
[connect.sh] Меню:
  [r]estart claude — перезапуск Claude Code
  [u]pdate claude  — обновление
  [s]hell          — обычный bash
  [q]uit           — закрыть терминал
    │
    ▼
Выбор → действие → терминал не закрывается
```

---

## 8. Решения по архитектуре

### Почему один Node.js процесс

- Express раздаёт статику (HTML, CSS, JS) — nginx не нужен
- ws обрабатывает WebSocket на том же порте
- node-pty спавнит процессы — нет отдельного backend
- Один порт (7681) для всего = простая конфигурация

### Почему connect.sh, а не прямой запуск claude

- Проверка авторизации (claude login если нужно)
- Меню после выхода (не теряем терминал)
- Возможность обновления из меню
- shell fallback для отладки

### Почему PWA

- "Add to Home Screen" на телефоне = полноэкранное приложение
- Нет адресной строки = больше места для терминала
- Оффлайн-заглушка (service worker)
- Иконка на домашнем экране

### Почему без tmux

- WebSocket поддерживает persistent connection
- node-pty процесс живёт в контейнере пока контейнер работает
- Claude Code имеет --resume / --continue для восстановления сессий
- tmux добавляет complexity без benefit в нашем случае

### Почему express-session в памяти

- Один пользователь, один сервер
- При рестарте контейнера перелогин — не проблема (cookie 7 дней, но session в RAM)
- Нет нужды в Redis/файловом хранилище
- Простота > масштабируемость

---

## 9. Безопасность

| Аспект | Решение |
|--------|---------|
| Контейнер | Non-root user (UID 1000) |
| Claude Code | --dangerously-skip-permissions (осознанно) |
| Sudo | NOPASSWD для обновлений |
| Web auth | Session cookie (httpOnly, SameSite) |
| Пароль | Из env variable, не хардкод |
| Volumes | /project rw, .claude rw |
| Network | Только LAN (порт не проброшен наружу) |
| XSS | textContent вместо innerHTML |

---

## 10. Мобильный UX приоритеты

1. **100dvh терминал** — максимальное использование экрана
2. **Extra keys панель** — Tab, Ctrl, Esc, стрелки (как Termux)
3. **PWA mode** — без адресной строки, как нативное приложение
4. **30s keepalive** — сессия не умирает при блокировке экрана
5. **Auto-reconnect** — прогрессивный retry с UI feedback
6. **14px шрифт** — читаемо на мобильном, кнопки +/- для настройки
7. **Touch events** — long press = paste, swipe left = Esc
8. **Toast уведомления** — не блокирующие, анимированные
9. **Safe area insets** — поддержка вырезов/островков
10. **No zoom on input** — font-size 16px на inputs
