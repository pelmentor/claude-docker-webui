#!/bin/bash
set -euo pipefail

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

# 2. Update Claude Code
echo "----------------------------------------"
echo "[*] Checking Claude Code version..."
CURRENT_VERSION=$(su - claude -c "claude --version 2>/dev/null" || echo "not installed")
echo "[*] Current version: ${CURRENT_VERSION}"

echo "[*] Checking for updates..."
UPDATE_LOG="/home/claude/.claude/update.log"
mkdir -p /home/claude/.claude
chown claude:claude /home/claude/.claude

if su - claude -c "npm update -g @anthropic-ai/claude-code 2>&1" | tee /tmp/update_output.txt; then
    NEW_VERSION=$(su - claude -c "claude --version 2>/dev/null" || echo "unknown")
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
    cat /tmp/update_output.txt >> "${UPDATE_LOG}" 2>/dev/null || true
fi
rm -f /tmp/update_output.txt
chown claude:claude "${UPDATE_LOG}" 2>/dev/null || true

# 3. Verify Claude Code works
echo "----------------------------------------"
if su - claude -c "claude --version" > /dev/null 2>&1; then
    echo "[OK] Claude Code is functional"
else
    echo "[ERROR] Claude Code not found in PATH!"
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
exec su - claude -c "cd /home/claude/web && node server.js"
