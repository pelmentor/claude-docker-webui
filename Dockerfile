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

# Install Claude Code (native installer)
RUN su - claude -c "curl -fsSL https://claude.ai/install.sh | sh"

# Web application
WORKDIR /home/claude/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY web/ ./

# Remove build deps no longer needed at runtime
RUN apt-get purge -y build-essential python3 make && \
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

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:7681/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
