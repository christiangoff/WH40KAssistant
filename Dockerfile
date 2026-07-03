# Stage 1: install deps (needs build tools for better-sqlite3 native module)
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: build the Next.js app
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: lean production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Rebuild native modules (better-sqlite3) then remove build tools
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/proxy.ts ./

# data/ is a persistent volume: SQLite DB + uploaded files
VOLUME /app/data

EXPOSE 3002
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "-p", "3002"]
