# Claude Code Docker — Инструкция

## 1. Запуск на Unraid

```bash
docker run -d --name claude-docker-webui -p 7681:7681 \
  -v /mnt/user/obsmedia:/project \
  -v /mnt/user/appdata/claude-docker/auth:/home/claude/.claude \
  -v /mnt/user/appdata/claude-docker/bin:/home/claude/.local \
  -e CLAUDE_USER=claude \
  -e CLAUDE_PASSWORD=claude \
  --restart unless-stopped \
  ghcr.io/pelmentor/claude-docker-webui:latest
```

Первый запуск занимает 1-2 минуты (установка Claude Code).

### Проверка логов

```bash
docker logs -f claude-docker-webui
```

Должно быть:
```
[OK] User password set
[*] First run — installing Claude Code...
[OK] Claude Code installed
[OK] Claude Code is functional (2.x.x)
[OK] /project mounted (N items)
[Claude Code Web] Listening on http://0.0.0.0:7681
```

---

## 2. Открыть веб-панель с телефона

1. Открой браузер на телефоне
2. Перейди на `http://UNRAID_IP:7681`
3. Введи логин и пароль (по умолчанию: `claude` / `claude`)

### Добавить на домашний экран (PWA)

**iOS Safari:** Поделиться → На экран Домой → Добавить

**Android Chrome:** Меню → Добавить на главный экран → Установить

---

## 3. Первый раз — вход в Claude

При первом запуске Claude Code попросит авторизоваться:

1. Откроется ссылка для авторизации
2. Скопируй её (долгое нажатие → Копировать)
3. Открой ссылку в другом браузере (или на ПК)
4. Авторизуйся через Anthropic аккаунт
5. Вернись в терминал — Claude Code будет готов

Авторизация сохраняется в `/mnt/user/appdata/claude-docker/auth/` — при перезапуске повторный логин не нужен.

---

## 4. Ежедневная работа

1. Открой приложение (PWA или браузер)
2. Cookie помнит тебя — сразу попадаешь в терминал
3. Claude Code запущен и готов к работе в `/project`

### Кнопки управления

| Кнопка | Действие |
|--------|---------|
| Restart | Перезапускает Claude Code |
| Update | Обновляет Claude Code до последней версии |
| New | Запускает Claude Code с чистой сессией |
| Menu (мобильный) | Все кнопки + версия, проект, аптайм |

### Дополнительные клавиши (мобильный)

Панель внизу экрана: `Tab`, `Ctrl`, `Esc`, стрелки, `|`, `/`, `~`

### Жесты

- **Долгое нажатие** → вставка из буфера
- **Свайп влево** → Escape
- **Тройное нажатие** → настройки размера шрифта

### Меню после выхода из Claude

При выходе через `/exit`:
- `[r]` — перезапустить Claude Code
- `[u]` — обновить Claude Code
- `[s]` — обычный bash
- `[q]` — закрыть терминал

---

## 5. Обновление Claude Code

Нажми кнопку **Update** в хедере. Или из меню connect.sh — `[u]`.

---

## 6. Обновление образа контейнера

```bash
docker pull ghcr.io/pelmentor/claude-docker-webui:latest && docker rm -f claude-docker-webui && docker run -d --name claude-docker-webui -p 7681:7681 -v /mnt/user/obsmedia:/project -v /mnt/user/appdata/claude-docker/auth:/home/claude/.claude -v /mnt/user/appdata/claude-docker/bin:/home/claude/.local -e CLAUDE_USER=claude -e CLAUDE_PASSWORD=claude --restart unless-stopped ghcr.io/pelmentor/claude-docker-webui:latest
```

---

## 7. Что делать если соединение оборвалось

- Веб-панель автоматически переподключается (до 5 попыток)
- Если не помогло — нажми кнопку "Reconnect" или обнови страницу
- Claude Code продолжает работать в контейнере — сессия не потеряна

---

## Данные на Unraid

```
/mnt/user/appdata/claude-docker/
├── auth/              ← авторизация + конфиги Claude Code
│   ├── .claude.json   ← токен авторизации
│   └── ...
└── bin/               ← бинарник Claude Code
    └── bin/claude
```

## Полезные команды

```bash
docker logs -f claude-docker-webui          # Логи
docker restart claude-docker-webui          # Рестарт
docker rm -f claude-docker-webui            # Удалить контейнер
rm -rf /mnt/user/appdata/claude-docker      # Удалить все данные
```
