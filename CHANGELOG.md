# Changelog

## 2026-04-05

### Added
- Initial release
- Dockerfile on node:22-slim with non-root user claude (UID 1000)
- Web terminal: Express + xterm.js + node-pty + WebSocket
- Auth: login page with session cookies, remember me
- Mobile-first UI: extra keys (Tab, Ctrl, Esc, arrows), touch gestures, PWA
- WebSocket keepalive (30s ping/pong), auto-reconnect (5 attempts)
- connect.sh: auto-login, --dangerously-skip-permissions, post-exit menu
- update.sh: update Claude Code from terminal
- Status bar with connection indicator and session timer
- Toast notifications
- Dark theme with Claude orange accent
- GitHub Actions workflow for ghcr.io image build
- Healthcheck endpoint /api/health

### Changed
- Switched to native Claude Code installer (runs at first container boot)
- Claude Code binary persisted in claude-auth volume between restarts
- Container name: claude-docker-webui
