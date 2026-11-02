# Production image for moneypurse-web (Next.js). Multi-stage; runs `next start`.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3100
CMD ["npm", "run", "start", "--", "-p", "3100", "-H", "0.0.0.0"]
