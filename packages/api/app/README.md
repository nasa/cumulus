# Cumulus API Application

This directory contains the main Express application for the Cumulus API.

## Dual Deployment Modes

The API supports two deployment modes controlled by the `RUN_API_AS_SERVER` environment variable:

### Lambda Mode (Default)

When `RUN_API_AS_SERVER` is not set or is `false`, the API runs as an AWS Lambda handler:

```javascript
const { handler } = require('./index.js');
// Use handler for Lambda invocations
```

- Uses AWS Serverless Express
- Handles API Gateway events
- Deployed via Terraform as Lambda functions

### ECS/Server Mode

When `RUN_API_AS_SERVER=true`, the API runs as a standalone Express server:

```bash
RUN_API_AS_SERVER=true node index.js
```

- Listens on HTTP port (default: 5001, configurable via `PORT`)
- Suitable for container/ECS deployments
- Does not use AWS Serverless Express middleware

## Docker Deployment

**Before building the Docker image**, you must compile TypeScript locally:

```bash
# From workspace root
npm run tsc
```

Then build and run the API as a containerized service:

```bash
# Build from workspace root
docker build -f packages/api/app/Dockerfile -t cumulus-api:latest .

# Run the container
docker run -p 5001:5001 \
  -e api_config_secret_id=<your-secret-id> \
  -e dynamoTableNameString='{"AccessTokensTable":"..."}' \
  cumulus-api:latest
```

The Dockerfile automatically sets `RUN_API_AS_SERVER=true`.

## Required Environment Variables

- `api_config_secret_id`: AWS Secrets Manager secret ID containing API configuration
- `dynamoTableNameString`: JSON string with DynamoDB table names
- `PORT` (optional): Server port for ECS mode, defaults to 5001
- `RUN_API_AS_SERVER` (optional): Set to `true` for ECS/server mode

## Local Development

```bash
# Lambda mode (for testing Lambda behavior)
node index.js

# Server mode (for local API server)
RUN_API_AS_SERVER=true PORT=5001 node index.js
```
