# Анализ веб-консоли и терминала

Источник: `code-reference/pelican-wg-nginx/` — WG-Nginx Admin Panel.

---

## 1. Архитектура веб-терминала

### Высокоуровневый поток

```
Браузер (xterm.js) ←→ WebSocket ←→ Node.js сервер (ws) ←→ node-pty ←→ bash/claude
```

В нашем проекте упрощаем — убираем Nginx прокси (Node.js напрямую обслуживает и статику, и WebSocket).

### Стек в референсе

- **Frontend:** xterm.js + FitAddon + vanilla JS
- **Backend:** PHP + Go WebSocket сервер (через Nginx proxy)
- **Transport:** WebSocket (основной) + HTTP Polling (fallback)

### Наш стек

- **Frontend:** xterm.js + FitAddon + WebLinksAddon + vanilla JS
- **Backend:** Node.js (Express) + ws (WebSocket) + node-pty
- **Transport:** WebSocket only (node-pty требует двунаправленного потока)

---

## 2. Подключение xterm.js к WebSocket

### Инициализация терминала (из референса)

```javascript
const theme = {
    background: '#0a0a0a',
    cursor: '#f97316',
    black: '#000000',
    red: '#E54B4B',
    green: '#9ECE58',
    yellow: '#FAED70',
    blue: '#396FE2',
    magenta: '#BB80B3',
    cyan: '#2DDAFD',
    white: '#d0d0d0',
    brightBlack: 'rgba(255, 255, 255, 0.2)',
    brightRed: '#FF5370',
    brightGreen: '#C3E88D',
    brightYellow: '#FFCB6B',
    brightBlue: '#82AAFF',
    brightMagenta: '#C792EA',
    brightCyan: '#89DDFF',
    brightWhite: '#ffffff',
    selection: '#FAF089'
};

const terminal = new Terminal({
    fontSize: 14,          // 14px для мобильного (референс: 13px)
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    lineHeight: 1.2,
    cursorStyle: 'bar',
    cursorBlink: true,
    allowTransparency: false,
    theme: theme,
});

const fitAddon = new FitAddon.FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.getElementById('terminal'));
fitAddon.fit();
```

### Ключевые параметры для нашего проекта

| Параметр | Референс | Наш | Почему |
|---------|---------|-----|--------|
| fontSize | 13 | 14 | Лучше читаемость на мобильном |
| disableStdin | true | **false** | У нас интерактивный терминал |
| cursorStyle | underline | bar | Привычный стиль для CLI |
| cursorBlink | — | true | Визуальный feedback |
| allowTransparency | true | false | Не нужен, экономит ресурсы |
| rows | 25 | auto (fit) | fit addon определяет |

### WebSocket подключение

```javascript
// Из референса (console.js:78-125), адаптировано под наш проект:
let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';  // Для бинарных данных от node-pty

    ws.onopen = () => {
        reconnectAttempts = 0;
        updateStatus('connected');
        // Отправить размер терминала
        const { cols, rows } = terminal;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    };

    ws.onmessage = (event) => {
        // Данные от node-pty → терминал
        terminal.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data));
    };

    ws.onclose = () => {
        updateStatus('disconnected');
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            updateStatus('reconnecting', reconnectAttempts);
            reconnectTimer = setTimeout(connectWebSocket, 3000);
        }
    };

    ws.onerror = () => {
        // onclose сработает после onerror
    };
}

// Ввод с клавиатуры → WebSocket → node-pty
terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
    }
});

// Ресайз → WebSocket → node-pty
terminal.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
});
```

---

## 3. Переподключение при обрыве связи

### Стратегия из референса

```javascript
// console.js:114-122
ws.onclose = () => {
    terminal.writeln('');
    terminal.writeln('\x1b[1m\x1b[33m[WebSocket disconnected — reconnecting in 3s...]\x1b[0m');
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
};
```

**Особенности:**
- Фиксированная задержка 3 секунды
- Нет лимита попыток (бесконечный reconnect)
- Визуальный feedback в терминале

### Наша улучшенная стратегия

```javascript
const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 5000]; // Прогрессивная задержка

ws.onclose = () => {
    updateStatus('disconnected');
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
        reconnectAttempts++;
        updateStatus('reconnecting', reconnectAttempts);
        reconnectTimer = setTimeout(connectWebSocket, delay);
    } else {
        // Показать кнопку "Reconnect manually"
        showManualReconnect();
    }
};
```

**Улучшения:**
- Прогрессивная задержка (1s → 2s → 3s → 5s)
- Максимум 5 попыток, затем ручной реконнект
- Счётчик попыток в статус-баре
- Буферизация ввода при кратковременном обрыве

### UI feedback при переподключении

```
Статус-бар цвета:
- Зелёный (#22c55e) = Connected
- Жёлтый (#eab308) + анимация = Reconnecting (attempt 2/5)
- Красный (#ef4444) = Disconnected — кнопка "Reconnect"
```

---

## 4. Мобильная адаптация

### Viewport (из референса)

```html
<!-- layout.php:13 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

### Наша расширенная настройка

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#0a0a0a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

### Терминал на мобильном

**Референс (app.css:220-224):**
```css
@media (max-width: 1023px) {
    #terminal { height: 400px !important; }
}
```

**Наш подход (лучше):**
```css
#terminal {
    height: 100dvh;  /* Dynamic viewport height — учитывает клавиатуру */
}
```

`100dvh` автоматически уменьшается при появлении виртуальной клавиатуры, вместо скролла за экран.

### Touch-события

Референс не реализует touch-события для терминала. Наш план:
- Долгое нажатие (500ms) = вставка из буфера
- Свайп влево = Escape
- Дополнительная панель кнопок: Tab, Ctrl, Esc, стрелки, |, /, ~

### Sidebar на мобильном (из референса)

```javascript
// layout.php:264-276
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = !sidebar.classList.contains('-translate-x-full');
    if (isOpen) {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    } else {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    }
}
```

**HTML:**
```html
<div id="sidebar-overlay" class="fixed inset-0 bg-black/60 z-40 hidden lg:hidden"
    onclick="toggleSidebar()"></div>
<aside id="sidebar" class="fixed top-0 left-0 z-50 w-64 ...
    transition-transform duration-200 -translate-x-full lg:translate-x-0">
</aside>
```

---

## 5. Fit Addon (авто-ресайз)

### Из референса (console.js:54-59)

```javascript
const fitAddon = new FitAddon.FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.getElementById('terminal'));
fitAddon.fit();
window.addEventListener('resize', () => fitAddon.fit());
```

### Как работает

1. `fitAddon.fit()` рассчитывает размер: `cols = floor(containerWidth / charWidth)`, `rows = floor(containerHeight / charHeight)`
2. Вызывается при window resize — терминал подстраивается
3. Результат передаётся через `terminal.onResize()` → WebSocket → node-pty

### Критический CSS для правильной работы fit

```css
/* Из console.php:35-36 */
.terminal-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;        /* КРИТИЧНО: позволяет flex-children сжиматься */
    overflow: hidden;      /* Предотвращает scrollbars */
}

#terminal {
    flex: 1;
    width: 100%;
    min-height: 0;        /* КРИТИЧНО для fit addon */
}
```

**Без `min-height: 0`** — flex-children не могут уменьшиться ниже content size, и fit addon неправильно рассчитывает rows.

### Наши дополнения

```javascript
// Дополнительный fit при:
// 1. Появлении/скрытии клавиатуры на мобильном
window.visualViewport?.addEventListener('resize', () => fitAddon.fit());

// 2. Ориентации экрана
window.addEventListener('orientationchange', () => {
    setTimeout(() => fitAddon.fit(), 100);  // Задержка для рендера
});

// 3. После reconnect
ws.onopen = () => {
    fitAddon.fit();
    // Отправить новые размеры серверу
};
```

---

## 6. Ввод с мобильной клавиатуры

### Референс (console.js:188-233)

Референс использует отдельный `<input>` для команд — НЕ подходит для интерактивного терминала.

```javascript
// Подход референса: отдельный input
document.getElementById('command-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const cmd = cmdInput.value;
        // POST /api/console/command
    }
});
```

### Наш подход: прямой ввод в xterm.js

xterm.js сам обрабатывает keyboard input через `terminal.onData()`:

```javascript
terminal.onData((data) => {
    // data — строка с нажатыми клавишами
    // Отправляем напрямую в WebSocket → node-pty → bash/claude
    ws.send(data);
});
```

На мобильных устройствах xterm.js перехватывает события виртуальной клавиатуры через скрытый textarea. Для улучшения мобильного UX добавляем:

### Дополнительная панель кнопок (как Termux)

```html
<div class="extra-keys">
    <button data-key="\t">Tab</button>
    <button data-key="\x01" class="modifier">Ctrl</button>
    <button data-key="\x1b">Esc</button>
    <button data-key="\x1b[A">↑</button>
    <button data-key="\x1b[B">↓</button>
    <button data-key="\x1b[D">←</button>
    <button data-key="\x1b[C">→</button>
    <button data-key="|">|</button>
    <button data-key="/">/</button>
    <button data-key="~">~</button>
</div>
```

```javascript
document.querySelectorAll('.extra-keys button').forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        navigator.vibrate?.(10);  // Тактильный feedback
        const key = btn.dataset.key;
        if (btn.classList.contains('modifier')) {
            // Ctrl — следующий символ будет с Ctrl
            ctrlMode = true;
        } else {
            ws.send(ctrlMode ? String.fromCharCode(key.charCodeAt(0) - 96) : key);
            ctrlMode = false;
        }
    });
});
```

---

## 7. WebSocket keepalive / ping-pong

### Референс

**Не реализован** в pelican-wg-nginx. Reconnect через 3 секунды при обрыве.

### Наша реализация

**Серверная сторона (Node.js):**
```javascript
// Ping каждые 30 секунд
const PING_INTERVAL = 30000;

wss.on('connection', (ws) => {
    ws.isAlive = true;
    
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, PING_INTERVAL);
```

**Клиентская сторона:**
```javascript
// ws.ping() от сервера автоматически отвечается pong (спецификация WebSocket)
// Дополнительно: application-level heartbeat для обнаружения zombie connections

setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat' }));
    }
}, 25000);
```

**Почему 30 секунд:**
- Мобильные сети закрывают idle TCP после ~60 секунд
- 30 секунд — безопасный интервал с запасом
- Не слишком частый — не тратит батарею

---

## 8. Конкретные фрагменты кода для переиспользования

### 8.1 ANSI цвета для терминала
**Источник:** `console.js:13-17`
```javascript
const ERROR_STYLE = '\x1b[1m\x1b[31m';    // Bold red
const WARN_STYLE = '\x1b[1m\x1b[33m';     // Bold yellow
const INFO_STYLE = '\x1b[1m\x1b[32m';     // Bold green
const RESET = '\x1b[0m';
```

### 8.2 Keyboard shortcuts handler
**Источник:** `console.js:62-73`
```javascript
terminal.attachCustomKeyEventHandler((event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        const selection = terminal.getSelection();
        if (selection) {
            navigator.clipboard.writeText(selection);
            return false;  // Не отправлять Ctrl+C в терминал
        }
    }
    return true;
});
```

### 8.3 Command history в localStorage
**Источник:** `console.js:180-186`
```javascript
const history = JSON.parse(localStorage.getItem('terminal-history')) || [];
function saveHistory() {
    localStorage.setItem('terminal-history', JSON.stringify(history.slice(0, 50)));
}
```

### 8.4 Terminal CSS
**Источник:** `app.css:56-84`
```css
#terminal {
    overflow: hidden;
    background: #030712;
}
#terminal .xterm { padding: 8px 0; }
.xterm .xterm-viewport {
    scrollbar-width: thin;
    scrollbar-color: #1f2937 transparent;
}
.xterm .xterm-rows > div {
    padding-left: 10px;
    padding-right: 10px;
}
```

### 8.5 Animated status dot
**Источник:** `dashboard.php:97-100`
```html
<span class="status-dot">
    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
    <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
</span>
```
