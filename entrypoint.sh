#!/bin/bash
set -euo pipefail

CLAUDE_BIN="/home/claude/.local/bin/claude"
CLAUDE_PATH="/home/claude/.local/bin"

echo "========================================"
echo "  Claude Code Docker Container"
echo "========================================"

# 1. Set user password
if [ -n "${CLAUDE_PASSWORD:-}" ]; then
    echo "claude:${CLAUDE_PASSWORD}" | chpasswd 2>/dev/null
    echo "[OK] User password set"
else
    echo "[WARN] CLAUDE_PASSWORD not set, using default"
    echo "claude:claude" | chpasswd 2>/dev/null
fi

# 2. Install Claude Code (first run only, updates via UI button)
echo "----------------------------------------"
mkdir -p /home/claude/.claude /home/claude/.local
chown claude:claude /home/claude/.claude /home/claude/.local

# TRAP: Claude Code stores auth token in ~/.claude.json (file in HOME),
# NOT inside ~/.claude/ (directory). Without this symlink, auth is lost
# on container recreation because only ~/.claude/ is a persisted volume.
# Symlink it into the volume so it survives restarts.
if [ -f /home/claude/.claude/.claude.json ] && [ ! -L /home/claude/.claude.json ]; then
    # Auth file exists in volume from previous run — restore symlink
    ln -sf /home/claude/.claude/.claude.json /home/claude/.claude.json
    chown -h claude:claude /home/claude/.claude.json
    echo "[OK] Auth restored from volume"
elif [ -f /home/claude/.claude.json ] && [ ! -L /home/claude/.claude.json ]; then
    # Auth file exists as regular file — move it into volume and symlink
    mv /home/claude/.claude.json /home/claude/.claude/.claude.json
    ln -sf /home/claude/.claude/.claude.json /home/claude/.claude.json
    chown -h claude:claude /home/claude/.claude.json
    chown claude:claude /home/claude/.claude/.claude.json
elif [ ! -e /home/claude/.claude.json ]; then
    # No auth file — create symlink target so Claude writes into the volume
    touch /home/claude/.claude/.claude.json
    chown claude:claude /home/claude/.claude/.claude.json
    ln -sf /home/claude/.claude/.claude.json /home/claude/.claude.json
    chown -h claude:claude /home/claude/.claude.json
fi

if [ -x "${CLAUDE_BIN}" ]; then
    VERSION=$("${CLAUDE_BIN}" --version 2>/dev/null || echo "unknown")
    echo "[OK] Claude Code found (${VERSION})"
else
    echo "[*] First run — installing Claude Code..."
    if su -s /bin/bash claude -c "curl -fsSL https://claude.ai/install.sh | bash" 2>&1; then
        echo "[OK] Claude Code installed"
        echo "$(date '+%Y-%m-%d %H:%M:%S') Installed" >> /home/claude/.claude/update.log
    else
        echo "[ERROR] Installation failed!"
        exit 1
    fi
    chown -R claude:claude /home/claude/.claude /home/claude/.local 2>/dev/null || true
fi

# 3. Verify Claude Code works
echo "----------------------------------------"
if [ -x "${CLAUDE_BIN}" ] && "${CLAUDE_BIN}" --version > /dev/null 2>&1; then
    VERSION=$("${CLAUDE_BIN}" --version 2>/dev/null)
    echo "[OK] Claude Code is functional (${VERSION})"
else
    echo "[ERROR] Claude Code not found at ${CLAUDE_BIN}!"
    echo "[DEBUG] Contents of /home/claude/.local/bin/:"
    ls -la /home/claude/.local/bin/ 2>/dev/null || echo "(directory does not exist)"
    exit 1
fi

# 4. Check /project mount
echo "----------------------------------------"
if [ -d /project ]; then
    FILE_COUNT=$(ls -A /project 2>/dev/null | wc -l)
    if [ "${FILE_COUNT}" -gt 0 ]; then
        echo "[OK] /project mounted (${FILE_COUNT} items)"
    else
        echo "[WARN] /project is empty — mount your project files"
    fi
else
    echo "[WARN] /project not mounted"
fi

# 5. Add claude to PATH in bashrc for interactive shells
grep -q "${CLAUDE_PATH}" /home/claude/.bashrc 2>/dev/null || \
    echo "export PATH=\"${CLAUDE_PATH}:\$PATH\"" >> /home/claude/.bashrc
chown claude:claude /home/claude/.bashrc

# 6. Start web panel
echo "----------------------------------------"
echo "[*] Starting web panel on port 7681..."
echo "========================================"

cd /home/claude/web
# TRAP: `su` without `-l` does NOT reset HOME — Node.js would see HOME=/root,
# causing express-session and other packages to probe wrong directories.
# Use explicit HOME export to ensure correct user environment.
exec su -s /bin/bash claude -c "export HOME=/home/claude PATH=${CLAUDE_PATH}:\$PATH && cd /home/claude/web && node server.js"
