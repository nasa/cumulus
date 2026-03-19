FROM node:22-alpine

# Install build tools (needed for native npm modules)
RUN apk add --no-cache python3 make g++ git bash

# Create non-root user
RUN addgroup -g 433 -S task && \
    adduser -u 431 -S task -G task

WORKDIR /app

# 1. Copy configuration (Added wildcard for tsconfig*.json)
COPY package*.json lerna.json tsconfig*.json .eslint* ./

# 2. Copy the packages
COPY packages ./packages

# 3. Install ALL dependencies
RUN npm install -w @cumulus/api --include-workspace-root --ignore-scripts

# 4. Build the API
# This should now find /app/tsconfig.base.json
RUN npx lerna run build --scope=@cumulus/api --include-dependencies

# 5. Remove build tools to shrink the image
RUN npm prune --omit=dev

# 6. Set permissions
RUN chown -R task:task /app

USER task
WORKDIR /app/packages/api
EXPOSE 5001

# Cumulus specific environment variables
ENV NODE_ENV=production
ENV RUN_API_AS_SERVER=true

# Start the API server directly - initEnvVarsFunction will load secrets from AWS
CMD ["node", "app/index.js"]
