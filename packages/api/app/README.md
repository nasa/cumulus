# Cumulus API Application

This directory contains two separate Express applications that share the same codebase but are deployed and operated differently.

---

## Cumulus API — Lambda (`index.js`)

The main Cumulus API is deployed as an **AWS Lambda function** behind API Gateway. It is **not** run locally or in Docker — it is deployed and tested via Terraform and the standard Cumulus deployment process.

- Entry point: `index.js`
- Uses AWS Serverless Express to handle API Gateway events
- Serves all read/write API endpoints (collections, granules, executions, providers, rules, etc.)
- Creates new Postgresql database connections per invocation
- Deployed via Terraform as Lambda functions

---

## Cumulus Iceberg API — ECS (`iceberg-index.js`)

A separate, limited **read-only** API deployed as a **long-running ECS Fargate service**. It queries Iceberg tables via AWS Glue and DuckDB instead of the primary Postgresql database.

- Entry point: `iceberg-index.js`
- Runs as a standalone Express HTTP server (port 5001 by default)
- Deployed via Terraform as an ECS Fargate service with an Application Load Balancer
- Only exposes read-only list endpoints:

### Endpoint coverage

  | Endpoint | Auth | Description |
  |---|---|---|
  | `GET /health` | No | Readiness/health status |
  | `GET /version` | No | API version metadata |
  | `GET /granules` | Yes | List granules |
  | `GET /collections` | Yes | List collections |
  | `GET /executions` | Yes | List executions |
  | `GET /providers` | Yes | List providers |
  | `GET /pdrs` | Yes | List PDRs |
  | `GET /rules` | Yes | List rules |
  | `GET /asyncOperations` | Yes | List async operations |
  | `GET /reconciliationReports` | Yes | List reconciliation reports |
  | `GET /stats` | Yes | Stats summary |
  | `GET /stats/aggregate/:type?` | Yes | Aggregate statistics |

  All list endpoints are also accessible under the `/v1/` prefix (e.g. `GET /v1/granules`).
- Uses a singleton DuckDB connection pool for better performance

### Docker image

Build from repository root:

```bash
docker build --platform linux/arm64 -f packages/api/app/Dockerfile -t cumulus-iceberg-api:latest .
```

The Dockerfile hosts the Iceberg API in-container. In production the image is pushed to GHCR as part of the CICD and run by ECS. See [docs/deployment/iceberg-api.md](../../../docs/deployment/iceberg-api.md) and [tf-modules/iceberg_api/README.md](../../../tf-modules/iceberg_api/README.md) for deployment configuration.

### Environment variables (Iceberg API)

#### Required by server startup

| Variable | Description |
|---|---|
| `api_config_secret_id` | Secrets Manager ARN/name containing API configuration values |
| `dynamoTableNameString` | JSON map of DynamoDB env var names to table names, e.g. `{"AccessTokensTable":"my-table"}` |

#### Required for Iceberg catalog access

| Variable | Description |
|---|---|
| `AWS_ACCOUNT_ID` | AWS account ID used when attaching Glue Iceberg catalog |
| `ICEBERG_NAMESPACE` | Glue database/schema containing Iceberg tables |

#### Common optional variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5001` | HTTP listen port |
| `AWS_REGION` | `us-east-1` | AWS region for Glue/S3 access |
| `DUCKDB_MAX_POOL_SIZE` | `3` | DuckDB connection pool size |
| `DUCKDB_POOL_REBUILD_INTERVAL_SECONDS` | `18000` | Preemptive pool rebuild interval (5 hours) |
| `NODE_ENV` | _(unset)_ | Set to `development` to have DuckDB auto-install extensions (Mac/local use); production uses pre-bundled extensions from the Docker image |

### Local Development (Iceberg API only)

> **Note:** Local development applies only to the Iceberg API (`iceberg-index.js`). The main Cumulus API (`index.js`) is deployed via Lambda and is not run locally.

AWS credentials must be configured in your environment (via `~/.aws`, SSO session, or env vars). The server connects to the real sandbox AWS Glue catalog.

#### Run with Node.js

```bash
NODE_ENV=development \
api_config_secret_id=<your-secret-manager-arn> \
dynamoTableNameString='{"AccessTokensTable":"<sandbox-table-name>"}' \
AWS_ACCOUNT_ID=<your-aws-account-id> \
ICEBERG_NAMESPACE=<your-glue-schema> \
AWS_REGION=us-east-1 \
PORT=5001 \
node packages/api/app/iceberg-index.js
```

Then test it (`$token` is a Cumulus API token obtained from the [`/token` endpoint](https://nasa.github.io/cumulus-api/#token) of the deployed Cumulus API):

```bash
curl http://localhost:5001/version
curl -H "Authorization: Bearer $token" "http://localhost:5001/granules"
```

#### Run With Docker

An `env.local.example` file is provided as a template. Copy it and fill in your values before running:

```bash
cp packages/api/app/env.local.example packages/api/app/.env.local
# Edit .env.local with your sandbox values

docker build --platform linux/arm64 -f packages/api/app/Dockerfile -t cumulus-iceberg-api:latest .
docker run --rm -p 5001:5001 --env-file packages/api/app/.env.local cumulus-iceberg-api:latest
```

#### Local AVA integration test

This mirrors `bamboo/iceberg-api-integration-tests.sh` to run tests against the Sandbox environment specified in packages/api/app/.env.local:

```bash
# load env vars from your local env file
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  export "$line"
done < packages/api/app/.env.local

# test-mode settings
export PORT=5001
export FAKE_AUTH=true
export TOKEN_SECRET=test-secret-12345
export NODE_ENV=test

# Start Iceberg API locally
node packages/api/app/iceberg-index.js > iceberg-server-debug.log 2>&1 &
SERVER_PID=$!

# Run the integration test
./node_modules/.bin/ava packages/api/tests/docker/test-iceberg-api.js --timeout=5m

# Cleanup
kill $SERVER_PID
```
