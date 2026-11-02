# Production image for pqc-sidecar. Multi-stage, non-root, dev-deps pruned.
# Node 26 is REQUIRED: X25519MLKEM768 / ML-KEM need the OpenSSL >= 3.5 embedded in Node 26.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
# TLS data plane :8443, loopback admin (healthz/readyz/livez) :8081
EXPOSE 8443 8081
CMD ["node", "dist/src/main.js"]
