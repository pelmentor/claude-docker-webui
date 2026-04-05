#!/bin/bash
set -euo pipefail

CLAUDE_BIN="/home/claude/.claude/local/bin/claude"

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

# 2. Install or update Claude Code
echo "----------------------------------------"
mkdir -p /home/claude/.claude
chown claude:claude /home/claude/.claude
UPDATE_LOG="/home/claude/.claude/update.log"

if [ -x "${CLAUDE_BIN}" ]; then
    CURRENT_VERSION=$(su - claude -c "${CLAUDE_BIN} --version 2>/dev/null" || echo "unknown")
    echo "[*] Current version: ${CURRENT_VERSION}"
    echo "[*] Checking for updates..."

    if su - claude -c "curl -fsSL https://claude.ai/install.sh | sh" 2>&1 | tee /tmp/update_output.txt; then
        NEW_VERSION=$(su - claude -c "${CLAUDE_BIN} --version 2>/dev/null" || echo "unknown")
        if [ "${NEW_VERSION}" != "${CURRENT_VERSION}" ]; then
            echo "[OK] Updated: ${CURRENT_VERSION} -> ${NEW_VERSION}"
            echo "$(date '+%Y-%m-%d %H:%M:%S') Updated: ${CURRENT_VERSION} -> ${NEW_VERSION}" >> "${UPDATE_LOG}"
        else
            echo "[OK] Already latest: ${NEW_VERSION}"
            echo "$(date '+%Y-%m-%d %H:%M:%S') Already latest: ${NEW_VERSION}" >> "${UPDATE_LOG}"
        fi
    else
        echo "[WARN] Update failed, continuing with current version"
        echo "$(date '+%Y-%m-%d %H:%M:%S') Update failed" >> "${UPDATE_LOG}"
    fi
else
    echo "[*] First run — installing Claude Code..."
    if su - claude -c "curl -fsSL https://claude.ai/install.sh | sh" 2>&1; then
        echo "[OK] Claude Code installed"
        echo "$(date '+%Y-%m-%d %H:%M:%S') Installed" >> "${UPDATE_LOG}"
    else
        echo "[ERROR] Installation failed!"
        exit 1
    fi
fi
rm -f /tmp/update_output.txt
chown -R claude:claude /home/claude/.claude 2>/dev/null || true

# 3. Verify Claude Code works
echo "----------------------------------------"
if su - claude -c "${CLAUDE_BIN} --version" > /dev/null 2>&1; then
    VERSION=$(su - claude -c "${CLAUDE_BIN} --version 2>/dev/null")
    echo "[OK] Claude Code is functional (${VERSION})"
else
    echo "[ERROR] Claude Code not found!"
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

# 5. Start web panel
echo "----------------------------------------"
echo "[*] Starting web panel on port 7681..."
echo "========================================"

cd /home/claude/web
exec su - claude -c "export PATH=/home/claude/.claude/local/bin:\$PATH && cd /home/claude/web && node server.js"
