FROM node:22-slim

# Install build tools
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    bash \
    ca-certificates \
    openssl \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 433 task && \
    useradd -u 431 -g task -m task

# Create a shared directory for DuckDB extensions
RUN mkdir -p /app/.duckdb_extensions && chown -R task:task /app/.duckdb_extensions
ENV DUCKDB_EXTENSION_DIRECTORY=/app/.duckdb_extensions

WORKDIR /app

COPY package*.json lerna.json tsconfig*.json .eslint* ./
COPY packages ./packages

RUN npm install -w @cumulus/api --include-workspace-root
RUN npx lerna run build --scope=@cumulus/api --include-dependencies
RUN npm prune --omit=dev

RUN chown -R task:task /app

# Update your pre-install script to use this directory
# Inside your Dockerfile
RUN node -e "\
const { DuckDBInstance } = require('@duckdb/node-api'); \
(async () => { \
  const db = await DuckDBInstance.create(':memory:'); \
  const conn = await db.connect(); \
  const versionRes = await conn.run('SELECT version()'); \
  const version = (await versionRes.getRows())[0][0]; \
  console.log('Detected DuckDB Version:', version); \
  \
  await conn.run(\"SET extension_directory='/app/.duckdb_extensions';\"); \
  await conn.run('INSTALL httpfs;'); \
  await conn.run('INSTALL iceberg;'); \
  await conn.run('INSTALL aws;'); \
  await conn.run('INSTALL parquet;'); \
  await conn.run('INSTALL avro;'); \
  await conn.run('INSTALL json;'); \
})().catch(e => { console.error(e); process.exit(1); });"

RUN chown -R task:task /app/.duckdb_extensions
USER task

WORKDIR /app/packages/api

EXPOSE 5001
ENV NODE_ENV=production

CMD ["node", "app/iceberg-index.js"]