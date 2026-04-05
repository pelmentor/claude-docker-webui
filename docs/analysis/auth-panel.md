# Анализ авторизации и UI панели

Источник: `code-reference/pelican-wg-nginx/` — WG-Nginx Admin Panel.

---

## 1. Страница логина

### Разметка (из login.php)

```html
<body class="bg-gray-950 text-gray-100 min-h-screen flex items-center justify-center">

<!-- Фоновый градиент -->
<div class="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))]
    from-gray-900 via-gray-950 to-gray-950"></div>

<div class="relative w-full max-w-sm mx-4">
    <!-- Брендинг -->
    <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl
            bg-blue-600/10 border border-blue-500/20 mb-4">
            <svg class="w-7 h-7 text-blue-400"><!-- Иконка --></svg>
        </div>
        <h1 class="text-xl font-bold text-white">WG-Nginx</h1>
        <p class="text-sm text-gray-500 mt-1">Admin Panel</p>
    </div>

    <!-- Карточка логина -->
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <!-- Ошибка -->
        <div class="flex items-center gap-2 bg-red-500/10 border border-red-500/20
            text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
            <svg><!-- Alert icon --></svg>
            Error message
        </div>

        <form method="POST">
            <label class="block text-sm font-medium text-gray-400 mb-2">Username</label>
            <input type="text" name="username" autofocus required
                class="w-full px-4 py-2.5 bg-gray-950 border border-gray-800 rounded-lg
                    text-white text-sm focus:ring-2 focus:ring-blue-500/40 transition" />

            <label class="block text-sm font-medium text-gray-400 mb-2 mt-4">Password</label>
            <input type="password" name="password" required
                class="w-full px-4 py-2.5 bg-gray-950 border border-gray-800 rounded-lg
                    text-white text-sm focus:ring-2 focus:ring-blue-500/40 transition" />

            <button type="submit"
                class="w-full mt-4 px-4 py-2.5 bg-blue-600 hover:bg-blue-500
                    text-white text-sm font-medium rounded-lg transition">
                Sign in
            </button>
        </form>
    </div>
</div>
```

### UX паттерны

| Паттерн | Реализация | Берём? |
|---------|-----------|--------|
| Вертикальное центрирование | `min-h-screen flex items-center justify-center` | Да |
| Автофокус | `autofocus` на username | Да (на password) |
| Submit по Enter | Стандартное поведение `<form>` | Да |
| Сохранение username при ошибке | `value="<?= htmlspecialchars(...) ?>"` | Нет (один пользователь) |
| Подсказка с кредами | Внизу формы мелким текстом | Нет |
| Фоновый градиент | Radial gradient от серого к тёмному | Да |

### Наши дополнения к логину

- **Показать/скрыть пароль** — иконка глазика
- **"Запомнить меня"** — долгоживущий cookie (7 дней)
- **Поля 48px высотой** — удобно на мобильном
- **font-size: 16px** на input — предотвращает zoom на iOS при фокусе
- **Цвет акцента** — оранжевый (#f97316) вместо синего (Claude branding)

---

## 2. Авторизация (сессии, cookies)

### Референс: PHP сессии

```php
// Auth.php
session_set_cookie_params([
    'lifetime' => 0,          // Сессионный cookie
    'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']),
    'httponly' => true,       // JS не может прочитать
    'samesite' => 'Strict',  // Защита от CSRF
]);
session_start();
```

**Session timeout:** 1800 секунд (30 минут) с обновлением при каждом запросе.

**CSRF защита:** Токен в `<input type="hidden" name="_csrf">` и в `X-CSRF-Token` заголовке.

### Наша реализация: Express + cookie-session

```javascript
// Простой подход для single-user
const session = require('express-session');

app.use(session({
    secret: crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 дней для "запомнить"
        sameSite: 'strict',
    }
}));

// Login route
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.CLAUDE_USER && password === process.env.CLAUDE_PASSWORD) {
        req.session.authenticated = true;
        req.session.loginTime = Date.now();
        res.redirect('/');
    } else {
        res.render('login', { error: 'Invalid credentials' });
    }
});

// Auth middleware
function requireAuth(req, res, next) {
    if (req.session?.authenticated) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.redirect('/login');
}
```

### Отличия от референса

| Аспект | Референс | Наш проект |
|--------|---------|-----------|
| Backend | PHP sessions (file-based) | Express sessions (memory) |
| CSRF | Обязательный токен | Не нужен (SameSite cookie) |
| Timeout | 30 минут | 7 дней (мобильный use-case) |
| Пароль | Bcrypt hash в JSON | Plain env var сравнение |
| Мульти-юзер | Да (roles, permissions) | Нет (один пользователь) |
| Rate limiting | 5/мин на IP | Не нужно (private network) |

**Почему без CSRF:** SameSite=Strict cookie + нет cross-origin requests в нашем случае. Контейнер доступен только из локальной сети.

**Почему без bcrypt:** Пароль уже в env var — хешировать нет смысла, сравниваем напрямую.

---

## 3. Структура панели (layout)

### Референс: layout.php

```
┌─────────────────────────────────────────────┐
│ Header (sticky top, h-16, backdrop-blur)    │
│ [☰ Mobile] [Server] [Status ●] [Address]   │
├──────────┬──────────────────────────────────┤
│ Sidebar  │ Main content                     │
│ (w-64)   │ (flex-1, p-4 lg:p-6)            │
│          │                                   │
│ Nav      │ Page content                     │
│ items    │ (dashboard/console/files/...)    │
│          │                                   │
│ ──────── │                                   │
│ User     │                                   │
│ Logout   │                                   │
└──────────┴──────────────────────────────────┘
```

**Desktop:** Sidebar всегда видна (lg:translate-x-0)
**Mobile:** Sidebar скрыта, hamburger toggle, overlay при открытии

### Наш layout (упрощённый)

```
Mobile (основной):
┌──────────────────────────────────┐
│ Header (h-11, compact)          │
│ [Claude Code] [v1.2] [≡ Menu]  │
├──────────────────────────────────┤
│                                  │
│ Terminal (flex-1, 100%)         │
│ xterm.js                        │
│                                  │
├──────────────────────────────────┤
│ Extra keys: Tab Ctrl Esc ↑↓←→  │
├──────────────────────────────────┤
│ Status: ● Connected | 0:42:15  │
└──────────────────────────────────┘

Desktop:
┌──────────────────────────────────────┐
│ Header                               │
│ [Claude Code v1.2.3] [project-name]  │
│ [Restart] [Update] [New Session]     │
├──────────────────────────────────────┤
│                                      │
│ Terminal (flex-1)                    │
│                                      │
├──────────────────────────────────────┤
│ ● Connected | Session: 0:42:15      │
└──────────────────────────────────────┘
```

**Без sidebar** — у нас только терминал, sidebar избыточен. Действия через кнопки в хедере / hamburger menu на мобильном.

---

## 4. Тёмная тема

### Референс: Tailwind dark mode

```javascript
// layout.php:20-54
tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                panel: {
                    bg:      '#030712',    // Фон
                    sidebar: '#111827',    // Sidebar
                    card:    '#111827',    // Карточки
                    border:  '#1f2937',    // Границы
                },
            },
        },
    },
}
```

```html
<html lang="en" class="dark">
```

### Наша палитра (Claude-themed)

| Элемент | Цвет | Hex |
|---------|------|-----|
| Background | Почти чёрный | #0a0a0a |
| Surface/Cards | Тёмно-серый | #141414 |
| Borders | Серый | #262626 |
| Text primary | Белый | #fafafa |
| Text secondary | Серый | #a1a1a1 |
| Accent (Claude) | Оранжевый | #f97316 |
| Success | Зелёный | #22c55e |
| Warning | Жёлтый | #eab308 |
| Error | Красный | #ef4444 |
| Terminal bg | Чёрный | #000000 |

### CSS переменные

```css
:root {
    --bg: #0a0a0a;
    --surface: #141414;
    --border: #262626;
    --text: #fafafa;
    --text-secondary: #a1a1a1;
    --accent: #f97316;
    --success: #22c55e;
    --warning: #eab308;
    --error: #ef4444;
}
```

### Scrollbar styling (из референса app.css:24-55)

```css
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.14);
}
```

---

## 5. Обработка ошибок

### Референс: API helper с auto-redirect

```javascript
// app.js:31-75
const api = {
    async get(url) {
        try {
            const res = await fetch(url);
            if (res.status === 401) { window.location = '/login'; return null; }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                return err;
            }
            return await res.json();
        } catch (e) {
            return null;
        }
    },
    async post(url, data) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (res.status === 401) { window.location = '/login'; return null; }
        if (res.status >= 400) {
            const err = await res.json().catch(() => ({}));
            Toast.error(err.error || `Request failed (${res.status})`);
            return err;
        }
        return res.json();
    }
};
```

**Берём:** auto-redirect на /login при 401, Toast для ошибок.

### Toast система (из app.js:4-22)

```javascript
const Toast = {
    show(message, type = 'success', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const span = document.createElement('span');
        span.textContent = message;  // XSS-safe: textContent, не innerHTML
        toast.appendChild(span);
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },
    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error', 5000); },
    warning(msg) { this.show(msg, 'warning', 4000); },
};
```

### Toast CSS (app.css:172-217)

```css
.toast {
    display: flex;
    align-items: center;
    min-width: 280px;
    max-width: 420px;
    padding: 12px 16px;
    border-radius: 8px;
    background: #111827;
    border: 1px solid #1f2937;
    border-left: 4px solid #3b82f6;
    color: #e2e8f0;
    font-size: 0.8125rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    animation: toast-in 300ms ease-out both;
}

.toast-success { border-left-color: #22c55e; }
.toast-error   { border-left-color: #ef4444; }
.toast-warning { border-left-color: #f59e0b; }

@keyframes toast-in {
    from { opacity: 0; transform: translateX(100%); }
    to   { opacity: 1; transform: translateX(0); }
}
.toast-exit {
    animation: toast-out 300ms ease-in both;
}
@keyframes toast-out {
    from { opacity: 1; transform: translateX(0); }
    to   { opacity: 0; transform: translateX(100%); }
}
```

**Берём полностью** — Toast уведомления вместо alert().

---

## 6. Адаптивная вёрстка для мобильных

### Breakpoints (из референса)

| Prefix | Width | Использование |
|--------|-------|--------------|
| (none) | 0px | Mobile first |
| sm | 640px | Tablet |
| lg | 1024px | Desktop |

### Паттерны из референса

**1. Гамбургер-меню (только mobile):**
```html
<button class="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white">
    <!-- Menu icon -->
</button>
```

**2. Адаптивный padding:**
```html
<main class="p-4 lg:p-6">
```

**3. Responsive grid:**
```html
<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
```

**4. Горизонтальный скролл info-бара на mobile:**
```html
<div class="flex items-center gap-3 overflow-x-auto scrollbar-none">
```

**5. Кнопки — иконки на mobile, с текстом на desktop:**
```html
<button>
    <svg><!-- icon --></svg>
    <span class="hidden sm:inline">Restart</span>
</button>
```

### Наши адаптации

| Mobile | Desktop |
|--------|---------|
| Хедер 44px, только иконки | Хедер полный, текст на кнопках |
| Hamburger для меню | Все кнопки видны |
| Extra keys панель | Не показывается |
| Статус-бар минимальный | Статус-бар подробный |
| Terminal 100dvh | Terminal calc(100vh - header - statusbar) |

---

## 7. CSS/HTML паттерны для нашего проекта

### 7.1 Анимированный индикатор статуса
```html
<span class="relative flex h-2.5 w-2.5">
    <span class="animate-ping absolute h-full w-full rounded-full bg-green-400 opacity-75"></span>
    <span class="relative rounded-full h-2.5 w-2.5 bg-green-500"></span>
</span>
```

### 7.2 Card с полупрозрачным border
```html
<div class="bg-gray-900 border border-gray-800 rounded-xl p-6">
```

### 7.3 Focus ring на inputs
```css
input:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.4);  /* Оранжевый ring */
    border-color: rgba(249, 115, 22, 0.4);
}
```

### 7.4 Button states
```css
.btn {
    transition: all 150ms;
}
.btn:hover { opacity: 0.9; }
.btn:active { transform: scale(0.97); }  /* Feedback на нажатие */
```

### 7.5 Safe area для iPhone с вырезом
```css
body {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
}
```

### 7.6 Prevent overscroll bounce (iOS)
```css
html, body {
    overscroll-behavior: none;
    -webkit-overflow-scrolling: touch;
}
```

### 7.7 Backdrop blur header
```css
header {
    background: rgba(10, 10, 10, 0.8);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}
```
