# Cumulus API Application

This directory contains the main Express application for the Cumulus API.

## Dual Deployment Modes

The Cumulus API supports two separate deployment modes with distinct entry points:

### Lambda Mode (Default) - `index.js`

The full Cumulus API runs as an AWS Lambda handler, serving all API endpoints:

```javascript
const { handler } = require('./index.js');
// Use handler for Lambda invocations
```

- Uses AWS Serverless Express
- Handles API Gateway events
- Deployed via Terraform as Lambda functions
- Serves all API endpoints (collections, granules, executions, providers, rules, etc.)
- Creates new database connections per invocation

### Iceberg API Mode (ECS) - `iceberg-index.js`

A limited read-only API that runs as a standalone Express server in ECS querying iceberg tables:

```bash
node app/iceberg-index.js
```

- Listens on HTTP port (default: 5001, configurable via `PORT`)
- Suitable for container/ECS deployments
- Does not use AWS Serverless Express middleware
- Only exposes read-only list endpoints:

  | Endpoint | Description |
  |---|---|
  | `GET /version` | API version (no auth required) |
  | `GET /granules` | List granules |
  | `GET /collections` | List collections |
  | `GET /executions` | List executions |
  | `GET /providers` | List providers |
  | `GET /pdrs` | List PDRs |
  | `GET /rules` | List rules |
  | `GET /async-operations` | List async operations |
  | `GET /reconciliation-reports` | List reconciliation reports |
  | `GET /stats` | Statistics summary |
  | `GET /stats/aggregate/:type?` | Aggregate statistics |

  All list endpoints are also accessible under the `/v1/` prefix (e.g. `GET /v1/granules`).
- Uses a singleton DuckDB connection pool for better performance

## Docker Deployment

Build and run the API as a containerized service:

```bash
# Build from workspace root
docker build -f packages/api/app/Dockerfile -t cumulus-iceberg-api:latest .

# Run against AWS (production/staging)
docker run -p 5001:5001 \
  -e api_config_secret_id=<your-secret-id> \
  -e dynamoTableNameString='{"AccessTokensTable":"<table-name>"}' \
  -e AWS_REGION=us-east-1 \
  -e ICEBERG_ACCOUNT_ID=<account-id> \
  -e ICEBERG_BUCKET_NAME=<bucket-name> \
  -e ICEBERG_TABLE_PATH=<base-path>/<namespace> \
  cumulus-iceberg-api:latest
```

The Dockerfile automatically uses `iceberg-index.js` as the entry point.

## Environment Variables

### Required (both modes)

| Variable | Description |
|---|---|
| `dynamoTableNameString` | JSON string mapping table env-var names to DynamoDB table names, e.g. `{"AccessTokensTable":"my-table"}` |
| `api_config_secret_id` | AWS Secrets Manager secret ID containing API configuration (skipped when `NODE_ENV=test`) |

### Optional — Iceberg API server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5001` | HTTP port the server listens on |
| `DUCKDB_MAX_POOL` | `20` | DuckDB connection pool size |

### Optional — Authentication

| Variable | Description |
|---|---|
| `FAKE_AUTH=true` | Bypass authentication (for local testing only) |
| `TOKEN_SECRET` | Secret used to sign JWT tokens; required when `FAKE_AUTH=true` (e.g. `test-secret`) |

### Optional — Iceberg data source

Set `LOCAL_ICEBERG_PATH` to query from a local directory instead of AWS S3 Tables (useful for local testing without AWS credentials).
The server creates DuckDB views using `read_iceberg()` for each table, so the directory must contain one Iceberg table per resource:

```
LOCAL_ICEBERG_PATH/<namespace>/
    granules/metadata/...
    collections/metadata/...
    executions/metadata/...
    files/metadata/...
    granules_executions/metadata/...
    pdrs/metadata/...
    providers/metadata/...
    rules/metadata/...
    async_operations/metadata/...
    reconciliation_reports/metadata/...
```

| Variable | Default | Description |
|---|---|---|
| `ICEBERG_TABLE_PATH` | _(required)_ | Full path to the namespace directory containing the table directories (e.g. `s3://my-bucket/cumulus` or `/local/path/cumulus`) |

When `LOCAL_ICEBERG_PATH` is **not** set, the server connects to AWS S3 Tables using:

| Variable | Default | Description |
|---|---|---|
| `ICEBERG_ACCOUNT_ID` | `1234567890` | AWS account ID owning the S3 table bucket |
| `ICEBERG_BUCKET_NAME` | `cumulus-table-bucket` | S3 table bucket name |
| `ICEBERG_TABLE_PATH` | _(required)_ | Full S3 path to the namespace directory (e.g. `s3://my-bucket/cumulus`) |
| `AWS_REGION` | `us-east-1` | AWS region |

## Local Development

### Running Locally (Node.js)

Set `NODE_ENV=test` to skip loading environment variables from AWS Secrets Manager,
and `FAKE_AUTH=true` to bypass authentication:

```bash
cd packages/api

# With a local Iceberg catalog directory
NODE_ENV=test \
FAKE_AUTH=true \
TOKEN_SECRET=test-secret \
dynamoTableNameString='{"AccessTokensTable":"local-AccessTokensTable"}' \
ICEBERG_TABLE_PATH=/Users/yliu10/Downloads/your_namespace \
PORT=5001 \
node app/iceberg-index.js
```

Then test it:

```bash
curl http://localhost:5001/version
curl http://localhost:5001/granules
curl http://localhost:5001/collections
```

### Running With Docker (Local Iceberg Catalog)

```bash
# Build from workspace root
docker build -f packages/api/app/Dockerfile -t cumulus-iceberg-api:latest .

# Run with a local Iceberg catalog mounted into the container
docker run -p 5001:5001 \
  -e NODE_ENV=test \
  -e FAKE_AUTH=true \
  -e TOKEN_SECRET=test-secret \
  -e dynamoTableNameString='{"AccessTokensTable":"local-AccessTokensTable"}' \
  -e ICEBERG_TABLE_PATH=/data/iceberg_catalog/your_namespace \
  -v /path/to/your/iceberg_catalog:/data/iceberg_catalog:ro \
  cumulus-iceberg-api:latest
```

Then test it:

```bash
curl http://localhost:5001/version
curl http://localhost:5001/granules
```
