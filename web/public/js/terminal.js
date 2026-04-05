// Terminal module — xterm.js + WebSocket + node-pty
(function () {
    'use strict';

    const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 5000];
    const MAX_RECONNECT_ATTEMPTS = 5;
    const HEARTBEAT_INTERVAL = 25000;

    let ws = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let heartbeatTimer = null;
    let inputBuffer = [];
    let ctrlMode = false;

    // Font size from localStorage
    const savedFontSize = parseInt(localStorage.getItem('claude-font-size')) || 14;

    // Terminal theme
    const theme = {
        background: '#000000',
        foreground: '#d4d4d4',
        cursor: '#f97316',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(249, 115, 22, 0.3)',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: '#E54B4B',
        green: '#9ECE58',
        yellow: '#FAED70',
        blue: '#396FE2',
        magenta: '#BB80B3',
        cyan: '#2DDAFD',
        white: '#d0d0d0',
        brightBlack: '#666666',
        brightRed: '#FF5370',
        brightGreen: '#C3E88D',
        brightYellow: '#FFCB6B',
        brightBlue: '#82AAFF',
        brightMagenta: '#C792EA',
        brightCyan: '#89DDFF',
        brightWhite: '#ffffff',
    };

    // Create terminal
    const terminal = new Terminal({
        fontSize: savedFontSize,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        lineHeight: 1.15,
        cursorStyle: 'bar',
        cursorBlink: true,
        theme: theme,
        allowProposedApi: true,
    });

    // Addons
    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    // Mount terminal
    const terminalEl = document.getElementById('terminal');
    terminal.open(terminalEl);

    // Initial fit
    requestAnimationFrame(() => {
        fitAddon.fit();
        // Hide skeleton
        const skeleton = document.getElementById('skeleton');
        if (skeleton) {
            skeleton.classList.add('hidden');
        }
    });

    // Resize handling
    function doFit() {
        fitAddon.fit();
    }

    window.addEventListener('resize', doFit);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', doFit);
    }
    window.addEventListener('orientationchange', () => setTimeout(doFit, 150));

    // Send resize to server
    terminal.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
    });

    // Terminal input → WebSocket
    terminal.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        } else {
            inputBuffer.push(data);
        }
    });

    // Keyboard shortcut: Ctrl+C copies selection if text is selected
    terminal.attachCustomKeyEventHandler((event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'c' && event.type === 'keydown') {
            const selection = terminal.getSelection();
            if (selection) {
                navigator.clipboard.writeText(selection).catch(() => {});
                return false;
            }
        }
        return true;
    });

    // --- WebSocket connection ---
    function connectWebSocket() {
        if (ws) {
            ws.onclose = null;
            ws.close();
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}/ws`;

        ws = new WebSocket(url);

        ws.onopen = () => {
            reconnectAttempts = 0;
            updateStatus('connected');
            hideReconnectOverlay();

            // Send terminal size
            const { cols, rows } = terminal;
            ws.send(JSON.stringify({ type: 'resize', cols, rows }));

            // Flush buffered input
            while (inputBuffer.length > 0) {
                ws.send(inputBuffer.shift());
            }

            // Start heartbeat
            clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'heartbeat' }));
                }
            }, HEARTBEAT_INTERVAL);

            Toast.success('Connected');
        };

        ws.onmessage = (event) => {
            terminal.write(event.data);
        };

        ws.onclose = () => {
            clearInterval(heartbeatTimer);
            updateStatus('disconnected');

            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
                reconnectAttempts++;
                updateStatus('reconnecting', reconnectAttempts);
                showReconnectOverlay(reconnectAttempts, false);
                reconnectTimer = setTimeout(connectWebSocket, delay);
            } else {
                showReconnectOverlay(reconnectAttempts, true);
            }
        };

        ws.onerror = () => {
            // onclose fires after onerror
        };
    }

    // --- Status updates ---
    function updateStatus(state, attempt) {
        const bar = document.getElementById('status-bar');
        const text = document.getElementById('status-text');

        bar.className = '';

        if (state === 'connected') {
            bar.classList.add('status-connected');
            text.textContent = 'Connected';
        } else if (state === 'reconnecting') {
            bar.classList.add('status-reconnecting');
            text.textContent = `Reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})...`;
        } else {
            bar.classList.add('status-disconnected');
            text.textContent = 'Disconnected';
        }
    }

    function showReconnectOverlay(attempts, showButton) {
        const overlay = document.getElementById('reconnect-overlay');
        const message = document.getElementById('reconnect-message');
        const btn = document.getElementById('btn-reconnect');

        overlay.classList.remove('hidden');

        if (showButton) {
            message.textContent = `Failed after ${attempts} attempts`;
            btn.classList.remove('hidden');
        } else {
            message.textContent = `Reconnecting... (${attempts}/${MAX_RECONNECT_ATTEMPTS})`;
            btn.classList.add('hidden');
        }
    }

    function hideReconnectOverlay() {
        document.getElementById('reconnect-overlay').classList.add('hidden');
    }

    // Manual reconnect button
    document.getElementById('btn-reconnect').addEventListener('click', () => {
        reconnectAttempts = 0;
        connectWebSocket();
    });

    // --- Font size ---
    function setFontSize(size) {
        size = Math.max(8, Math.min(24, size));
        terminal.options.fontSize = size;
        localStorage.setItem('claude-font-size', size);
        document.getElementById('font-size-display').textContent = size;
        fitAddon.fit();
    }

    document.getElementById('font-decrease').addEventListener('click', () => {
        setFontSize(terminal.options.fontSize - 1);
    });

    document.getElementById('font-increase').addEventListener('click', () => {
        setFontSize(terminal.options.fontSize + 1);
    });

    document.getElementById('font-size-display').textContent = savedFontSize;

    // Show font controls on triple-tap (mobile)
    let tapCount = 0;
    let tapTimer = null;
    terminalEl.addEventListener('touchend', () => {
        tapCount++;
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => {
            if (tapCount === 3) {
                const fc = document.getElementById('font-controls');
                fc.classList.toggle('visible');
                setTimeout(() => fc.classList.remove('visible'), 5000);
            }
            tapCount = 0;
        }, 300);
    });

    // --- Expose globals ---
    window.claudeTerminal = {
        terminal,
        fitAddon,
        ws: () => ws,
        connectWebSocket,
        setFontSize,
        get ctrlMode() { return ctrlMode; },
        set ctrlMode(v) { ctrlMode = v; },
        sendKey(key) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(key);
            }
        },
        getSize() {
            return { cols: terminal.cols, rows: terminal.rows };
        },
    };

    // Start connection
    connectWebSocket();
})();
