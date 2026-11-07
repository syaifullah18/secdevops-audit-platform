# syntax=docker/dockerfile:1
# SDAP API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t sdap-api .
# Stages: build (full workspace, compile) -> deploy (pnpm deploy --prod) -> runtime (slim, non-root).

FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN npm install --global pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@sdap/api..." \
 && pnpm --filter "@sdap/api..." build \
 && pnpm --filter @sdap/api deploy --legacy --prod /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    API_PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# The base image ships an unprivileged `node` user (uid 1000).
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
