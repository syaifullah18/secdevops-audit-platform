# SDAP egress proxy sidecar (zero dependencies).
# Build: docker build -t sdap-egress-proxy:latest deploy/sandbox/egress-proxy
# Pin the base image by digest in production builds.
FROM node:24-alpine

WORKDIR /app
COPY server.cjs .

# Unprivileged; DockerSandboxRunner additionally runs it --read-only with all
# capabilities dropped and no-new-privileges.
USER node
ENV NODE_ENV=production \
    PORT=3128 \
    HOST=0.0.0.0

EXPOSE 3128

ENTRYPOINT ["node", "/app/server.cjs"]
