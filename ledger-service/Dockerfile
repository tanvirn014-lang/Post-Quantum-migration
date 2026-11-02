# Production image for ledger-service. Multi-stage, non-root, dev-deps pruned.
# Node 26 is required (OpenSSL >= 3.5 for X25519MLKEM768 / ML-KEM). Pin by digest in a real deploy.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npx tsc -p tsconfig.json

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
# Readiness: GET /readyz ; liveness: GET /livez
CMD ["node", "dist/src/index.js"]
