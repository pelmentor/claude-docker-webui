#!/bin/bash

# Claude Code update script

echo -e "\033[1;36m======================================\033[0m"
echo -e "\033[1;36m  Claude Code Updater\033[0m"
echo -e "\033[1;36m======================================\033[0m"
echo ""

CURRENT_VERSION=$(claude --version 2>/dev/null || echo "unknown")
echo -e "\033[1;37m[*] Current version:\033[0m ${CURRENT_VERSION}"
echo -e "\033[1;37m[*] Checking for updates...\033[0m"
echo ""

if claude update 2>&1; then
    NEW_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    echo ""
    if [ "${NEW_VERSION}" != "${CURRENT_VERSION}" ]; then
        echo -e "\033[1;32m[OK] Updated: ${CURRENT_VERSION} -> ${NEW_VERSION}\033[0m"
        echo "$(date '+%Y-%m-%d %H:%M:%S') Updated: ${CURRENT_VERSION} -> ${NEW_VERSION}" >> /home/claude/.claude/update.log
    else
        echo -e "\033[1;32m[OK] Already latest: ${NEW_VERSION}\033[0m"
        echo "$(date '+%Y-%m-%d %H:%M:%S') Already latest: ${NEW_VERSION}" >> /home/claude/.claude/update.log
    fi
else
    echo ""
    echo -e "\033[1;31m[ERROR] Update failed!\033[0m"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Update failed" >> /home/claude/.claude/update.log
fi

echo ""
