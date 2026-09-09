FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY apps/server apps/server
COPY apps/worker-controller apps/worker-controller
COPY apps/web apps/web
COPY packages packages
RUN npm run build && npm run build:web && npm prune --omit=dev

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/ZeenSong/Jarvis" \
      org.opencontainers.image.version="0.2.0-rc.1" \
      org.opencontainers.image.description="Jarvis conversation and agent gateway"
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY package.json ./
USER node
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["node", "dist/apps/server/src/main.js"]
