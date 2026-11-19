# syntax=docker/dockerfile:1
# SDAP worker image. Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t sdap-worker .
# Includes git (to clone audit targets) and the vendored security-audit-skill.
# Stronger isolation for target code comes from the sandbox runtime (gVisor, WS8), not this image.

FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN npm install --global pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@sdap/worker..." \
 && pnpm --filter "@sdap/worker..." build \
 && pnpm --filter @sdap/worker deploy --legacy --prod /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    SDAP_SKILL_PATH=/opt/security-audit-skill/skills/security-audit \
    SDAP_OUTPUT_BASE_DIR=/var/lib/sdap/runs \
    SDAP_METRICS_PORT=9464
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/lib/sdap/runs \
 && chown node:node /var/lib/sdap/runs
# The audit agent: runs headless (`claude -p`) with ANTHROPIC_API_KEY. Pin with
# --build-arg CLAUDE_CODE_VERSION=<version> for reproducible images.
ARG CLAUDE_CODE_VERSION=latest
RUN npm install --global @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && npm cache clean --force
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=root:root /repo/vendor/security-audit-skill /opt/security-audit-skill
USER node
VOLUME ["/var/lib/sdap/runs"]
EXPOSE 9464
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.SDAP_METRICS_PORT||9464)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
