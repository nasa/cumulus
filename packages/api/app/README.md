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

### ECS Docker Image

The Iceberg API is packaged as a Docker image for ECS deployment:

```bash
# Build from workspace root
docker build -f packages/api/app/Dockerfile -t cumulus-iceberg-api:latest .
```

The Dockerfile automatically uses `iceberg-index.js` as the entry point. In production the image is pushed to ECR and run by ECS — `AWS_ACCOUNT_ID` and `ICEBERG_GLUE_SCHEMA` are injected as ECS task environment variables by Terraform.

---

## Environment Variables (Iceberg API only)

### Required

| Variable | Description |
|---|---|
| `api_config_secret_id` | AWS Secrets Manager secret ARN/name containing API configuration |
| `dynamoTableNameString` | JSON string mapping table env-var names to DynamoDB table names, e.g. `{"AccessTokensTable":"my-table"}` |
| `AWS_ACCOUNT_ID` | AWS account ID used to attach the Glue Iceberg catalog |
| `ICEBERG_GLUE_SCHEMA` | AWS Glue schema (database) name containing the Iceberg tables |

### Optional

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5001` | HTTP port the server listens on |
| `DUCKDB_MAX_POOL` | `20` | DuckDB connection pool size |
| `AWS_REGION` | `us-east-1` | AWS region |
| `NODE_ENV` | _(unset)_ | Set to `development` to have DuckDB auto-install extensions (Mac/local use); production uses pre-bundled extensions from the Docker image |

---

## Local Development (Iceberg API only)

> **Note:** Local development applies only to the Iceberg API (`iceberg-index.js`). The main Cumulus API (`index.js`) is deployed via Lambda and is not run locally.

AWS credentials must be configured in your environment (via `~/.aws`, SSO session, or env vars). The server connects to the real sandbox AWS Glue catalog.

### Running Locally (Node.js)

```bash
cd packages/api

NODE_ENV=development \
api_config_secret_id=<your-secret-manager-arn> \
dynamoTableNameString='{"AccessTokensTable":"<sandbox-table-name>"}' \
AWS_ACCOUNT_ID=<your-aws-account-id> \
ICEBERG_GLUE_SCHEMA=<your-glue-schema> \
AWS_REGION=us-east-1 \
PORT=5001 \
node app/iceberg-index.js
```

Then test it (`$token` is a Cumulus API token obtained from the [`/token` endpoint](https://nasa.github.io/cumulus-api/#token) of the deployed Cumulus API):

```bash
curl http://localhost:5001/version
curl -H "Authorization: Bearer $token" "http://localhost:5001/granules"
```

### Running With Docker

An `env.local.example` file is provided as a template. Copy it and fill in your values before running:

```bash
cp packages/api/app/env.local.example packages/api/app/.env.local
# Edit .env.local with your sandbox values
```

Then build and run:

```bash
# Build from workspace root
docker build -f packages/api/app/Dockerfile -t cumulus-iceberg-api:latest .

docker run --rm -p 5001:5001 \
  --env-file packages/api/app/.env.local \
  cumulus-iceberg-api:latest
```

Then test it (`$token` is a Cumulus API token obtained from the [`/token` endpoint](https://nasa.github.io/cumulus-api/#token) of the deployed Cumulus API):

```bash
curl http://localhost:5001/version
curl -H "Authorization: Bearer $token" "http://localhost:5001/granules"
```
