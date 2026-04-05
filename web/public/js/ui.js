// UI module — header buttons, menu, status, session timer
(function () {
    'use strict';

    const ct = window.claudeTerminal;

    // --- API helper ---
    async function apiPost(url, data) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (res.status === 401) {
                location.href = '/login';
                return null;
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                Toast.error(err.error || `Request failed (${res.status})`);
                return null;
            }
            return await res.json();
        } catch (e) {
            Toast.error('Network error');
            return null;
        }
    }

    // --- Actions ---
    function getSize() {
        return ct.getSize();
    }

    async function restartClaude() {
        Toast.show('Restarting Claude...', 'warning');
        const { cols, rows } = getSize();
        await apiPost('/api/restart', { cols, rows });
    }

    async function updateClaude() {
        Toast.show('Updating Claude...', 'warning');
        const { cols, rows } = getSize();
        await apiPost('/api/update', { cols, rows });
    }

    async function newSession() {
        Toast.show('Starting new session...', 'warning');
        const { cols, rows } = getSize();
        await apiPost('/api/new-session', { cols, rows });
    }

    // --- Header buttons (desktop) ---
    document.getElementById('btn-restart').addEventListener('click', restartClaude);
    document.getElementById('btn-update').addEventListener('click', updateClaude);
    document.getElementById('btn-new-session').addEventListener('click', newSession);

    // --- Mobile menu ---
    const menuOverlay = document.getElementById('menu-overlay');
    const btnMenu = document.getElementById('btn-menu');

    function openMenu() {
        menuOverlay.classList.remove('hidden');
        // Update menu info
        fetchStatus().then((data) => {
            if (data) {
                document.getElementById('menu-version').textContent = data.version;
                document.getElementById('menu-project').textContent = data.projectName;
                document.getElementById('menu-uptime').textContent = formatDuration(data.uptime);
            }
        });
    }

    function closeMenu() {
        menuOverlay.classList.add('hidden');
    }

    btnMenu.addEventListener('click', openMenu);
    menuOverlay.addEventListener('click', (e) => {
        if (e.target === menuOverlay) closeMenu();
    });

    document.getElementById('menu-restart').addEventListener('click', () => {
        closeMenu();
        restartClaude();
    });

    document.getElementById('menu-update').addEventListener('click', () => {
        closeMenu();
        updateClaude();
    });

    document.getElementById('menu-new-session').addEventListener('click', () => {
        closeMenu();
        newSession();
    });

    // --- Status fetching ---
    async function fetchStatus() {
        try {
            const res = await fetch('/api/status');
            if (res.status === 401) {
                location.href = '/login';
                return null;
            }
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    // Update header info
    async function updateHeaderInfo() {
        const data = await fetchStatus();
        if (!data) return;

        const versionEl = document.getElementById('header-version');
        const projectEl = document.getElementById('header-project');

        if (data.version) {
            versionEl.textContent = data.version;
        }
        if (data.projectName) {
            projectEl.textContent = data.projectName;
        }
    }

    updateHeaderInfo();
    // Refresh status every 5 minutes
    setInterval(updateHeaderInfo, 5 * 60 * 1000);

    // --- Update check ---
    async function checkForUpdate() {
        try {
            const res = await fetch('/api/check-update');
            if (!res.ok) return;
            const data = await res.json();
            if (data.updateAvailable) {
                Toast.warning(`Update available: ${data.latest} (current: ${data.current})`);
            }
        } catch (e) { /* ignore */ }
    }

    // Check after 10 seconds, then every hour
    setTimeout(checkForUpdate, 10000);
    setInterval(checkForUpdate, 60 * 60 * 1000);

    // --- Session timer ---
    let sessionStartTime = Date.now();

    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function updateTimer() {
        const elapsed = (Date.now() - sessionStartTime) / 1000;
        document.getElementById('session-timer').textContent = formatDuration(elapsed);
    }

    // Get session start from server
    fetchStatus().then((data) => {
        if (data && data.sessionStart) {
            sessionStartTime = data.sessionStart;
        }
    });

    setInterval(updateTimer, 1000);
    updateTimer();
})();
