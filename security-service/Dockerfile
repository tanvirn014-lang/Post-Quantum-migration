# Production image for security-service. Multi-stage, non-root, dev-deps pruned. Node 26 (OpenSSL >= 3.5).
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY schemas ./schemas
COPY cbom-sources ./cbom-sources
COPY ground-truth ./ground-truth
RUN npx tsc -p tsconfig.json

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/cbom-sources ./cbom-sources
COPY --from=build /app/ground-truth ./ground-truth
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3200
CMD ["node", "dist/src/index.js"]
