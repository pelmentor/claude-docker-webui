FROM node:22-slim

# System dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git curl sudo ca-certificates locales \
        build-essential python3 make && \
    sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && \
    locale-gen en_US.UTF-8 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Non-root user (node:22-slim already has node:1000, replace it)
RUN userdel -r node 2>/dev/null; \
    groupadd -g 1000 claude && \
    useradd -m -u 1000 -g 1000 -s /bin/bash claude && \
    echo "claude ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/claude && \
    chmod 0440 /etc/sudoers.d/claude

# Environment
ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    COLORTERM=truecolor \
    TERM=xterm-256color \
    SHELL=/bin/bash

# Claude Code installed at first boot via entrypoint (native installer)
# Persisted in claude-auth volume at /home/claude/.claude/

# Web application
WORKDIR /home/claude/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY web/ ./

# Vendor xterm.js assets — no CDN dependency at runtime
RUN mkdir -p public/vendor && \
    curl -fsSL https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css -o public/vendor/xterm.min.css && \
    curl -fsSL https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js -o public/vendor/xterm.min.js && \
    curl -fsSL https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js -o public/vendor/addon-fit.min.js && \
    curl -fsSL https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js -o public/vendor/addon-web-links.min.js

# Remove build deps no longer needed at runtime
# TRAP: apt-get autoremove after purging build-essential can remove libstdc++6
# which is needed at runtime by node-pty's native .node addon.
# Pin libstdc++6 explicitly before purging to prevent this.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libstdc++6 && \
    apt-get purge -y build-essential python3 make && \
    apt-get autoremove -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Scripts
COPY scripts/connect.sh scripts/update.sh /home/claude/
RUN chmod +x /home/claude/connect.sh /home/claude/update.sh

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Fix ownership
RUN chown -R claude:claude /home/claude

# Project mount point
RUN mkdir -p /project && chown claude:claude /project

EXPOSE 7681

# Healthcheck via node (no curl dependency needed at runtime)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "require('http').get('http://localhost:7681/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
