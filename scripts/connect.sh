#!/bin/bash

# Claude Code connection script
# Runs inside the terminal via node-pty

run_claude() {
    cd /project 2>/dev/null || cd ~

    # Check if Claude is authenticated
    if claude auth status > /dev/null 2>&1; then
        echo -e "\033[1;32m[*] Claude Code authenticated\033[0m"
        echo -e "\033[1;34m[*] Starting Claude Code in /project...\033[0m"
        echo ""
        claude --dangerously-skip-permissions
    else
        echo -e "\033[1;33m[*] Claude Code not authenticated\033[0m"
        echo -e "\033[1;33m[*] Starting login process...\033[0m"
        echo ""
        if claude login; then
            echo ""
            echo -e "\033[1;32m[OK] Login successful! Starting Claude Code...\033[0m"
            echo ""
            claude --dangerously-skip-permissions
        else
            echo ""
            echo -e "\033[1;31m[ERROR] Login failed\033[0m"
            return 1
        fi
    fi
}

show_menu() {
    echo ""
    echo -e "\033[1;36m======================================\033[0m"
    echo -e "\033[1;36m  Claude Code session ended\033[0m"
    echo -e "\033[1;36m======================================\033[0m"
    echo ""
    echo -e "  \033[1;37m[r]\033[0m  Restart Claude Code"
    echo -e "  \033[1;37m[u]\033[0m  Update Claude Code"
    echo -e "  \033[1;37m[s]\033[0m  Open shell"
    echo -e "  \033[1;37m[q]\033[0m  Quit"
    echo ""
    echo -n "  Choice: "
}

main() {
    while true; do
        run_claude
        EXIT_CODE=$?

        show_menu
        read -r -n 1 choice
        echo ""

        case "${choice}" in
            r|R)
                echo -e "\n\033[1;32m[*] Restarting Claude Code...\033[0m\n"
                continue
                ;;
            u|U)
                echo -e "\n\033[1;33m[*] Running update...\033[0m\n"
                /home/claude/update.sh
                echo ""
                echo -e "\033[1;32m[*] Restarting Claude Code...\033[0m\n"
                continue
                ;;
            s|S)
                echo -e "\n\033[1;34m[*] Opening shell (type 'exit' to return to menu)\033[0m\n"
                cd /project 2>/dev/null || cd ~
                bash
                continue
                ;;
            q|Q)
                echo -e "\n\033[1;33m[*] Goodbye!\033[0m"
                exit 0
                ;;
            *)
                echo -e "\n\033[1;31m[?] Invalid choice\033[0m"
                continue
                ;;
        esac
    done
}

main
