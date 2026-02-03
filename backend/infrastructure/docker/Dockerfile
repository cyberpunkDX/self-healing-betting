# ===========================================
# Base Stage
# ===========================================
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# ===========================================
# Dependencies Stage
# ===========================================
FROM base AS dependencies

# Install production dependencies
RUN npm ci --only=production

# Copy production node_modules aside
RUN cp -R node_modules prod_node_modules

# Install all dependencies (including dev)
RUN npm ci

# ===========================================
# Build Stage (if needed for TypeScript/etc)
# ===========================================
FROM base AS build

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Add build step here if using TypeScript
# RUN npm run build

# ===========================================
# Production Base
# ===========================================
FROM node:20-alpine AS production-base

WORKDIR /app

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy production dependencies
COPY --from=dependencies /app/prod_node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs . .

# Set user
USER nodejs

# Default environment
ENV NODE_ENV=production

# Health check base
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

# ===========================================
# API Gateway
# ===========================================
FROM production-base AS api-gateway

ENV SERVICE_NAME=api-gateway
EXPOSE 3000 3001

CMD ["node", "src/services/api-gateway/index.js"]

# ===========================================
# Bet Service
# ===========================================
FROM production-base AS bet-service

ENV SERVICE_NAME=bet-service

CMD ["node", "src/services/bet-service/index.js"]

# ===========================================
# User Service
# ===========================================
FROM production-base AS user-service

ENV SERVICE_NAME=user-service

CMD ["node", "src/services/user-service/index.js"]

# ===========================================
# Odds Service
# ===========================================
FROM production-base AS odds-service

ENV SERVICE_NAME=odds-service

CMD ["node", "src/services/odds-service/index.js"]

# ===========================================
# Wallet Service
# ===========================================
FROM production-base AS wallet-service

ENV SERVICE_NAME=wallet-service

CMD ["node", "src/services/wallet-service/index.js"]

# ===========================================
# Event Service
# ===========================================
FROM production-base AS event-service

ENV SERVICE_NAME=event-service

CMD ["node", "src/services/event-service/index.js"]

# ===========================================
# Settlement Service
# ===========================================
FROM production-base AS settlement-service

ENV SERVICE_NAME=settlement-service

CMD ["node", "src/services/settlement-service/index.js"]

# ===========================================
# Notification Service
# ===========================================
FROM production-base AS notification-service

ENV SERVICE_NAME=notification-service

CMD ["node", "src/services/notification-service/index.js"]

# ===========================================
# Health Monitor
# ===========================================
FROM production-base AS health-monitor

ENV SERVICE_NAME=health-monitor

CMD ["node", "src/services/health-monitor/index.js"]

# ===========================================
# All Services (Development/Monolith)
# ===========================================
FROM production-base AS all-services

ENV SERVICE_NAME=all

CMD ["node", "src/index.js"]
