# Cognigate API - TypeScript
# Standalone build that bundles runtime dependency

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Build runtime package first
FROM base AS runtime-builder
WORKDIR /app/runtime
COPY packages/runtime/package.json ./
COPY packages/runtime/tsconfig.json ./
COPY packages/runtime/src ./src
RUN npm install
RUN npm run build

# Build the API
FROM base AS api-builder
WORKDIR /app

# Copy API source
COPY apps/cognigate-api/package.json ./
COPY apps/cognigate-api/tsconfig.json ./
COPY apps/cognigate-api/src ./src

# Remove the runtime dependency line, install other deps
RUN sed -i '/@vorionsys\/runtime/d' package.json
RUN npm install

# Copy runtime into node_modules (with all its dependencies)
COPY --from=runtime-builder /app/runtime/dist ./node_modules/@vorionsys/runtime/dist
COPY --from=runtime-builder /app/runtime/package.json ./node_modules/@vorionsys/runtime/
COPY --from=runtime-builder /app/runtime/node_modules ./node_modules/@vorionsys/runtime/node_modules

# Build API
RUN npm run build

# Production stage - minimal image
FROM node:20-alpine AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 cognigate

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R cognigate:nodejs /app/data

# Copy built artifacts
COPY --from=api-builder --chown=cognigate:nodejs /app/dist ./dist
COPY --from=api-builder --chown=cognigate:nodejs /app/package.json ./
COPY --from=api-builder --chown=cognigate:nodejs /app/node_modules ./node_modules

USER cognigate

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV SQLITE_PATH=/app/data/cognigate.db

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
