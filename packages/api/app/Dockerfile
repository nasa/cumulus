FROM node:22-alpine

# Install build tools (needed for native npm modules)
RUN apk add --no-cache python3 make g++ git bash

# Create non-root user with specific UIDs/GIDs for security and consistency
# GID 433 and UID 431 are used to maintain consistent permissions across
# Cumulus infrastructure and avoid conflicts with common system IDs
RUN addgroup -g 433 -S task && \
    adduser -u 431 -S task -G task

WORKDIR /app

# Copy configuration and source code
COPY package*.json lerna.json tsconfig*.json .eslint* ./
COPY packages ./packages

# Install dependencies and build
RUN npm install -w @cumulus/api --include-workspace-root --ignore-scripts
RUN npx lerna run build --scope=@cumulus/api --include-dependencies
RUN npm prune --omit=dev

RUN chown -R task:task /app

USER task
WORKDIR /app/packages/api
EXPOSE 5001

# Cumulus specific environment variables
ENV NODE_ENV=production

# Start the Iceberg API server - iceberg-index.js loads secrets from AWS
CMD ["node", "app/iceberg-index.js"]
