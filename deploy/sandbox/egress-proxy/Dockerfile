# Multi-stage minimal egress proxy image
FROM node:24-alpine AS base

WORKDIR /app
COPY server.js .

USER node
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD node -e "const http=require('http'); http.get('http://127.0.0.1:8080', res => process.exit(0)).on('error', () => process.exit(1));"

ENTRYPOINT ["node", "server.js"]
