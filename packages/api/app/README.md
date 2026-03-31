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

A limited read-only API that runs as a standalone Express server in ECS:

```bash
node app/iceberg-index.js
```

- Listens on HTTP port (default: 5001, configurable via `PORT`)
- Suitable for container/ECS deployments
- Does not use AWS Serverless Express middleware
- Only exposes read-only list endpoints:
  - `GET /version`
  - `GET /granules` (list)
  - `GET /executions` (list)
  - `GET /stats` and `GET /stats/aggregate/:type?`
- Uses singleton database connection pool for better performance

## Docker Deployment

**Before building the Docker image**, you must compile TypeScript locally:

```bash
# From workspace root
npm run tsc
```

Then build and run the API as a containerized service:

```bash
# Build from workspace root
docker build -f packages/api/app/Dockerfile -t cumulus-iceberg-api:latest .

# Run the container
docker run -p 5001:5001 \
  -e api_config_secret_id=<your-secret-id> \
  -e dynamoTableNameString='{"AccessTokensTable":"..."}' \
  -e DEPLOY_ICEBERG_API=true \
  cumulus-iceberg-api:latest
```

The Dockerfile automatically uses `iceberg-index.js` as the entry point.

## Required Environment Variables

### For Lambda (index.js)
- `api_config_secret_id`: AWS Secrets Manager secret ID containing API configuration
- `dynamoTableNameString`: JSON string with DynamoDB table names

### For Iceberg API (iceberg-index.js)
- `api_config_secret_id`: AWS Secrets Manager secret ID containing API configuration
- `dynamoTableNameString`: JSON string with DynamoDB table names
- `DEPLOY_ICEBERG_API`: Set to `true` (tells connection layer to use singleton pattern)
- `PORT` (optional): Server port, defaults to 5001

## Local Development

### Running Locally (Node.js)

```bash
# Lambda mode (for testing Lambda behavior)
node index.js

# Iceberg API mode (for local API server with limited endpoints)
DEPLOY_ICEBERG_API=true PORT=5001 node iceberg-index.js
```

### Running with LocalStack (Docker)

For local development with full AWS service emulation:

```bash
# 1. Start LocalStack and dependencies (from workspace root)
npm run start-unit-test-stack

# 2. In another terminal, start the Iceberg API (from workspace root)
npm run start-iceberg-local

# 3. Access the API at http://localhost:5001
curl http://localhost:5001/version

# 4. Stop the Iceberg API when done
npm run stop-iceberg-local

# 5. Stop LocalStack and dependencies
npm run stop-unit-test-stack
```

The `start-iceberg-local` script:
- Builds the Docker image from `packages/api/app/Dockerfile`
- Runs the container connected to the LocalStack network
- Configures database connection to the local PostgreSQL instance
- Enables fake authentication for testing
- Exposes the API on port 5001

