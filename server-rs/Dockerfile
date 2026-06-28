# syntax=docker/dockerfile:1
# Build context = revklik-app/ root (so we can COPY both client/ and server-rs/).

# ---- 1. web: build the React/Vite SPA (monorepo workspace) ----
FROM oven/bun:1 AS web
WORKDIR /app
COPY package.json bun.lock turbo.json biome.json tsconfig.json ./
COPY shared/ ./shared/
COPY server/ ./server/
COPY cli/package.json ./cli/
COPY sdk/package.json ./sdk/
COPY client/ ./client/
RUN bun install           # postinstall builds shared+server workspaces (client needs shared dist)
WORKDIR /app/client
RUN bun run build          # → /app/client/dist

# ---- 2. builder: compile the Rust API ----
FROM rust:1.94-slim AS builder
ENV SQLX_OFFLINE=true
WORKDIR /app
COPY server-rs/Cargo.toml server-rs/Cargo.lock ./
# pre-fetch deps (layer cache): stub main then real sources
COPY server-rs/src ./src
COPY server-rs/migrations ./migrations
RUN cargo build --release --bin revklik-server

# ---- 3. runtime ----
FROM debian:stable-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/revklik-server /usr/local/bin/revklik-server
COPY --from=builder /app/migrations /app/migrations
COPY --from=web /app/client/dist /app/static

ENV TZ=UTC \
    REV_STATIC_DIR=/app/static \
    REV_HOST=0.0.0.0 \
    REV_PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8787/healthz || exit 1
ENTRYPOINT ["revklik-server"]
