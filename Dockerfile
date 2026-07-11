# Ein Image für web und worker — der Startbefehl entscheidet (s. docker-compose.yml)
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY . .
RUN npx prisma generate

EXPOSE 3000
# web:    npx prisma migrate deploy && npm run start
# worker: npm run worker
CMD ["npm", "run", "start"]
