FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npm install --no-save --omit=dev @openai/codex@0.154.0
COPY apps/node-bridge/src/main.mjs ./src/main.mjs
RUN printf '%s\n' '#!/bin/sh' 'set -eu' 'CODEX_HOME=/tmp/jarvis-codex-home' 'mkdir -p "$CODEX_HOME"' 'cp /seed-codex/auth.json "$CODEX_HOME/auth.json"' 'if [ -f /seed-codex/config.toml ]; then cp /seed-codex/config.toml "$CODEX_HOME/config.toml"; fi' 'export CODEX_HOME' 'exec /app/node_modules/.bin/codex "$@"' > /usr/local/bin/jarvis-codex && chmod 755 /usr/local/bin/jarvis-codex
ENV NODE_CODEX_BIN=/usr/local/bin/jarvis-codex
CMD ["node", "src/main.mjs"]
