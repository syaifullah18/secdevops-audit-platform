# syntax=docker/dockerfile:1
# SDAP web image (static Vite build behind unprivileged nginx). Build from the repository root:
#   docker build -f apps/web/Dockerfile -t sdap-web .
# nginx proxies /api to $API_UPSTREAM (default http://api:8080), so the browser stays same-origin.

FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN npm install --global pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@sdap/web..." \
 && pnpm --filter "@sdap/web..." build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS makes the entrypoint export NGINX_LOCAL_RESOLVERS from resolv.conf.
ENV API_UPSTREAM=http://api:8080 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY --chown=nginx:nginx deploy/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=nginx:nginx /repo/apps/web/dist /usr/share/nginx/html
# The base image runs as the unprivileged `nginx` user (uid 101) and listens on 8080.
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
