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
# -e DEPLOY_ICEBERG_API=true \
  cumulus-api:latest
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

```bash
# Lambda mode (full API)
node app/index.js

# Iceberg API mode (limited endpoints)
DEPLOY_ICEBERG_API=true PORT=5001 node app/iceberg-

```bash
# Lambda mode (for testing Lambda behavior)
node index.js

# Iceberg API mode (for local API server with limited endpoints)
DEPLOY_ICEBERG_API=true PORT=5001 node index.js
```
