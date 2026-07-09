# humanitarian-mcp — organisational self-hosting image.
# Runs the Streamable HTTP endpoint + dashboard on :8642 with a persistent
# SQLite cache under /data (mount a volume to keep it across restarts).
#
#   docker run -p 8642:8642 -v hmcp-cache:/data ghcr.io/ahmedvnabil/humanitarian-mcp
#
# For stdio mode (desktop clients), override the command:
#   docker run -i ghcr.io/ahmedvnabil/humanitarian-mcp node dist/index.js

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    HMCP_HTTP_HOST=0.0.0.0 \
    HMCP_CACHE=sqlite \
    HMCP_CACHE_PATH=/data/humanitarian-mcp.sqlite
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE README.md ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8642
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8642/api/status || exit 1
CMD ["node", "dist/index.js", "--http"]
