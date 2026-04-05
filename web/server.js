const express = require('express');
const session = require('express-session');
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const path = require('path');
const crypto = require('crypto');
const { execSync, exec } = require('child_process');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 7681;
const CLAUDE_USER = process.env.CLAUDE_USER || 'claude';
const CLAUDE_PASSWORD = process.env.CLAUDE_PASSWORD || 'claude';
// TRAP: Random secret = all sessions invalidated on every restart.
// Read from env var for persistence across container restarts.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
    console.warn('[WARN] SESSION_SECRET not set — sessions will not survive restarts');
}
const PING_INTERVAL = 30000;
const CLAUDE_BIN = '/home/claude/.local/bin/claude';
const CLAUDE_PATH = '/home/claude/.local/bin';

// Ensure claude is in PATH for this process
if (!process.env.PATH.includes(CLAUDE_PATH)) {
    process.env.PATH = `${CLAUDE_PATH}:${process.env.PATH}`;
}

// --- Session middleware ---
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware);

// --- Auth middleware ---
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.redirect('/login');
}

// --- Rate limiting ---
const loginAttempts = new Map(); // ip -> { count, resetAt }
const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function isLoginLocked(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry || Date.now() > entry.resetAt) return false;
    return entry.count >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginFailure(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + LOCKOUT_MS };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + LOCKOUT_MS; }
    entry.count++;
    loginAttempts.set(ip, entry);
}

// --- Public routes ---
app.get('/login', (req, res) => {
    if (req.session && req.session.authenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    if (isLoginLocked(ip)) {
        return res.redirect('/login?error=locked');
    }
    const { username, password, remember } = req.body;
    if (username === CLAUDE_USER && password === CLAUDE_PASSWORD) {
        loginAttempts.delete(ip);
        req.session.authenticated = true;
        req.session.username = username;
        req.session.loginTime = Date.now();
        if (remember === 'on') {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        }
        res.redirect('/');
    } else {
        recordLoginFailure(ip);
        res.redirect('/login?error=1');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Health endpoint (no auth)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// --- Protected routes ---
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Static files (protected)
app.use('/css', requireAuth, express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', requireAuth, express.static(path.join(__dirname, 'public', 'js')));

// Vendor assets (public — xterm.js bundled in image, no CDN needed)
app.use('/vendor', express.static(path.join(__dirname, 'public', 'vendor')));

// PWA assets (public — needed for service worker registration)
app.use('/manifest.json', express.static(path.join(__dirname, 'public', 'manifest.json')));
app.use('/sw.js', express.static(path.join(__dirname, 'public', 'sw.js')));
app.use('/icon-192.svg', express.static(path.join(__dirname, 'public', 'icon-192.svg')));
app.use('/icon-512.svg', express.static(path.join(__dirname, 'public', 'icon-512.svg')));

// --- Version cache (avoid blocking event loop with execSync on every request) ---
let cachedVersion = null;
let versionCachedAt = 0;
const VERSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getClaudeVersion() {
    const now = Date.now();
    if (cachedVersion && (now - versionCachedAt) < VERSION_CACHE_TTL) {
        return cachedVersion;
    }
    try {
        cachedVersion = execSync(`${CLAUDE_BIN} --version 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim();
        versionCachedAt = now;
    } catch (e) {
        cachedVersion = cachedVersion || 'unknown';
    }
    return cachedVersion;
}

// --- API routes ---
app.get('/api/status', requireAuth, (req, res) => {
    const version = getClaudeVersion();

    let projectName = '';
    try {
        const packageJson = path.join('/project', 'package.json');
        const fs = require('fs');
        if (fs.existsSync(packageJson)) {
            projectName = JSON.parse(fs.readFileSync(packageJson, 'utf8')).name || '';
        }
        if (!projectName) {
            projectName = path.basename(fs.realpathSync('/project'));
        }
    } catch (e) {
        projectName = 'project';
    }

    res.json({
        version,
        projectName,
        uptime: process.uptime(),
        sessionStart: req.session.loginTime || Date.now(),
    });
});

app.get('/api/check-update', requireAuth, async (req, res) => {
    try {
        const currentRaw = getClaudeVersion();
        // TRAP: claude --version outputs "2.1.92 (Claude Code)" but npm registry
        // returns clean "2.1.92". Extract semver to avoid permanent false-positive.
        const semverMatch = currentRaw.match(/(\d+\.\d+\.\d+)/);
        const current = semverMatch ? semverMatch[1] : currentRaw;
        const response = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest', {
            signal: AbortSignal.timeout(5000),
        });
        const data = await response.json();
        const latest = data.version || '';
        res.json({ current, latest, updateAvailable: latest && latest !== current });
    } catch (e) {
        res.json({ current: 'unknown', latest: 'unknown', updateAvailable: false });
    }
});

// --- Terminal management ---
// Terminal keyed by username — all devices of the same user see the same session.
// Different users get separate terminals.
const SCROLLBACK_LIMIT = 100 * 1024; // 100KB scrollback buffer
const terminals = new Map(); // username -> { pty, clients, scrollback }

function spawnTerminal(sessionId, cols, rows) {
    const existing = terminals.get(sessionId);
    if (existing) {
        // TRAP: kill() triggers onExit which calls terminals.delete(sessionId).
        // If onExit fires AFTER we set the new entry, it deletes the new one.
        // Detach onExit before killing to prevent this race condition.
        existing.pty.removeAllListeners?.('exit');
        existing.pty.kill();
    }

    const term = pty.spawn('/home/claude/connect.sh', [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: '/project',
        env: {
            ...process.env,
            HOME: '/home/claude',
            USER: 'claude',
            SHELL: '/bin/bash',
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            LANG: 'en_US.UTF-8',
        },
    });

    const entry = { pty: term, clients: existing ? existing.clients : new Set(), scrollback: '' };
    terminals.set(sessionId, entry);

    term.onData((data) => {
        // Append to scrollback buffer (ring buffer, keep last SCROLLBACK_LIMIT bytes)
        entry.scrollback += data;
        if (entry.scrollback.length > SCROLLBACK_LIMIT) {
            entry.scrollback = entry.scrollback.slice(-SCROLLBACK_LIMIT);
        }

        entry.clients.forEach((ws) => {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(data);
            }
        });
    });

    term.onExit(() => {
        // Only delete if this is still the current terminal for the session
        if (terminals.get(sessionId) === entry) {
            terminals.delete(sessionId);
        }
        entry.clients.forEach((ws) => {
            if (ws.readyState === 1) {
                ws.send('\r\n\x1b[1;31m[Terminal process exited]\x1b[0m\r\n');
            }
        });
    });

    return term;
}

// --- WebSocket server ---
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    // TRAP: sessionMiddleware expects a real ServerResponse object.
    // Passing {} works only when session is read-only (cookie already set).
    // If session needs to write headers (new session, expiry refresh), it would
    // call res.setHeader() on {} and throw. Use a shim to prevent crashes.
    const resShim = { getHeader() {}, setHeader() {}, end() {} };
    sessionMiddleware(request, resShim, () => {
        if (!request.session || !request.session.authenticated) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
});

wss.on('connection', (ws, request) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Terminal keyed by username — same user = same terminal across devices
    const terminalKey = request.session.username || 'default';
    let entry = terminals.get(terminalKey);
    if (!entry) {
        spawnTerminal(terminalKey, 80, 24);
        entry = terminals.get(terminalKey);
    }

    entry.clients.add(ws);

    // Replay scrollback buffer so reconnected client sees previous output
    if (entry.scrollback) {
        ws.send(entry.scrollback);
    }

    ws.on('message', (data) => {
        const msg = data.toString();

        // Check for control messages
        try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
                entry.pty.resize(parsed.cols, parsed.rows);
                return;
            }
            if (parsed.type === 'heartbeat') {
                return;
            }
        } catch (e) {
            // Not JSON — regular terminal input
        }

        // Forward input to pty
        if (entry.pty) {
            entry.pty.write(msg);
        }
    });

    ws.on('close', () => {
        if (entry) {
            entry.clients.delete(ws);
        }
    });
});

// Ping/pong keepalive
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, PING_INTERVAL);

wss.on('close', () => clearInterval(pingInterval));

// --- API: Terminal control ---
app.post('/api/restart', requireAuth, (req, res) => {
    const terminalKey = req.session.username || 'default';
    const cols = req.body.cols || 80;
    const rows = req.body.rows || 24;
    spawnTerminal(terminalKey, cols, rows);
    res.json({ ok: true, action: 'restart' });
});

app.post('/api/update', requireAuth, (req, res) => {
    const terminalKey = req.session.username || 'default';
    const entry = terminals.get(terminalKey);
    if (entry) {
        entry.pty.removeAllListeners?.('exit');
        entry.pty.kill();
    }

    // Spawn update script in terminal
    const term = pty.spawn('/home/claude/update.sh', [], {
        name: 'xterm-256color',
        cols: req.body.cols || 80,
        rows: req.body.rows || 24,
        cwd: '/home/claude',
        env: {
            ...process.env,
            HOME: '/home/claude',
            USER: 'claude',
            SHELL: '/bin/bash',
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            LANG: 'en_US.UTF-8',
        },
    });

    const newEntry = { pty: term, clients: entry ? entry.clients : new Set(), scrollback: '' };
    terminals.set(terminalKey, newEntry);

    term.onData((data) => {
        newEntry.scrollback += data;
        if (newEntry.scrollback.length > SCROLLBACK_LIMIT) {
            newEntry.scrollback = newEntry.scrollback.slice(-SCROLLBACK_LIMIT);
        }
        newEntry.clients.forEach((ws) => {
            if (ws.readyState === 1) ws.send(data);
        });
    });

    term.onExit(() => {
        // After update, restart with connect.sh
        setTimeout(() => {
            spawnTerminal(terminalKey, req.body.cols || 80, req.body.rows || 24);
        }, 1000);
    });

    res.json({ ok: true, action: 'update' });
});

app.post('/api/new-session', requireAuth, (req, res) => {
    const terminalKey = req.session.username || 'default';
    const entry = terminals.get(terminalKey);
    if (entry) {
        entry.pty.removeAllListeners?.('exit');
        entry.pty.kill();
    }

    // Spawn claude directly with fresh session
    const term = pty.spawn('bash', ['-c', `cd /project && ${CLAUDE_BIN} --dangerously-skip-permissions`], {
        name: 'xterm-256color',
        cols: req.body.cols || 80,
        rows: req.body.rows || 24,
        cwd: '/project',
        env: {
            ...process.env,
            HOME: '/home/claude',
            USER: 'claude',
            SHELL: '/bin/bash',
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            LANG: 'en_US.UTF-8',
        },
    });

    const newEntry = { pty: term, clients: entry ? entry.clients : new Set(), scrollback: '' };
    terminals.set(terminalKey, newEntry);

    term.onData((data) => {
        newEntry.scrollback += data;
        if (newEntry.scrollback.length > SCROLLBACK_LIMIT) {
            newEntry.scrollback = newEntry.scrollback.slice(-SCROLLBACK_LIMIT);
        }
        newEntry.clients.forEach((ws) => {
            if (ws.readyState === 1) ws.send(data);
        });
    });

    term.onExit(() => {
        // After exit, go back to connect.sh
        spawnTerminal(terminalKey, req.body.cols || 80, req.body.rows || 24);
    });

    res.json({ ok: true, action: 'new-session' });
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Claude Code Web] Listening on http://0.0.0.0:${PORT}`);
});
