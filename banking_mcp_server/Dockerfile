# Banking MCP Server Dockerfile
# Multi-stage build for production optimization

# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build:prod

# Remove dev dependencies
RUN npm prune --production

# Production stage
FROM node:20-alpine AS production

# Create app user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./

# Create necessary directories with proper permissions
RUN mkdir -p /app/data/tokens /app/logs && \
    chown -R appuser:appgroup /app/data /app/logs

# Install health check utility
RUN apk add --no-cache curl

# Copy health check script
COPY --chown=appuser:appgroup scripts/health-check.js ./scripts/

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node scripts/health-check.js localhost 8080 /health || exit 1

# Set environment
ENV NODE_ENV=production

# Start the application
CMD ["npm", "run", "start:prod"]

# Labels for metadata
LABEL maintainer="Banking MCP Server Team"
LABEL version="1.0.0"
LABEL description="Banking MCP Server for AI agent banking operations"