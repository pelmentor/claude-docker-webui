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
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
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

// --- Public routes ---
app.get('/login', (req, res) => {
    if (req.session && req.session.authenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password, remember } = req.body;
    if (username === CLAUDE_USER && password === CLAUDE_PASSWORD) {
        req.session.authenticated = true;
        req.session.loginTime = Date.now();
        if (remember === 'on') {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        }
        res.redirect('/');
    } else {
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

// PWA assets (public — needed for service worker registration)
app.use('/manifest.json', express.static(path.join(__dirname, 'public', 'manifest.json')));
app.use('/sw.js', express.static(path.join(__dirname, 'public', 'sw.js')));
app.use('/icon-192.svg', express.static(path.join(__dirname, 'public', 'icon-192.svg')));
app.use('/icon-512.svg', express.static(path.join(__dirname, 'public', 'icon-512.svg')));

// --- API routes ---
app.get('/api/status', requireAuth, (req, res) => {
    let version = 'unknown';
    try {
        version = execSync(`${CLAUDE_BIN} --version 2>/dev/null`, { encoding: 'utf8' }).trim();
    } catch (e) { /* ignore */ }

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
        const current = execSync(`${CLAUDE_BIN} --version 2>/dev/null`, { encoding: 'utf8' }).trim();
        const response = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest');
        const data = await response.json();
        const latest = data.version || '';
        res.json({ current, latest, updateAvailable: latest && latest !== current });
    } catch (e) {
        res.json({ current: 'unknown', latest: 'unknown', updateAvailable: false });
    }
});

// --- Terminal management ---
const terminals = new Map(); // sessionId -> { pty, clients }

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

    const entry = { pty: term, clients: existing ? existing.clients : new Set() };
    terminals.set(sessionId, entry);

    term.onData((data) => {
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
    const sessionId = request.session.id;

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Get or create terminal
    let entry = terminals.get(sessionId);
    if (!entry) {
        spawnTerminal(sessionId, 80, 24);
        entry = terminals.get(sessionId);
    }

    entry.clients.add(ws);

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
    const sessionId = req.session.id;
    const cols = req.body.cols || 80;
    const rows = req.body.rows || 24;
    // spawnTerminal handles killing the old pty safely (no race condition)
    spawnTerminal(sessionId, cols, rows);
    res.json({ ok: true, action: 'restart' });
});

app.post('/api/update', requireAuth, (req, res) => {
    const sessionId = req.session.id;
    const entry = terminals.get(sessionId);
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

    const newEntry = { pty: term, clients: entry ? entry.clients : new Set() };
    terminals.set(sessionId, newEntry);

    term.onData((data) => {
        newEntry.clients.forEach((ws) => {
            if (ws.readyState === 1) ws.send(data);
        });
    });

    term.onExit(() => {
        // After update, restart with connect.sh
        setTimeout(() => {
            spawnTerminal(sessionId, req.body.cols || 80, req.body.rows || 24);
        }, 1000);
    });

    res.json({ ok: true, action: 'update' });
});

app.post('/api/new-session', requireAuth, (req, res) => {
    const sessionId = req.session.id;
    const entry = terminals.get(sessionId);
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

    const newEntry = { pty: term, clients: entry ? entry.clients : new Set() };
    terminals.set(sessionId, newEntry);

    term.onData((data) => {
        newEntry.clients.forEach((ws) => {
            if (ws.readyState === 1) ws.send(data);
        });
    });

    term.onExit(() => {
        // After exit, go back to connect.sh
        spawnTerminal(sessionId, req.body.cols || 80, req.body.rows || 24);
    });

    res.json({ ok: true, action: 'new-session' });
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Claude Code Web] Listening on http://0.0.0.0:${PORT}`);
});
