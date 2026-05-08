#!/bin/bash
set -ex

. ./bamboo/set-bamboo-env-variables.sh

export api_config_secret_id=${bamboo_SECRET_API_CONFIG_SECRET_ID}
export dynamoTableNameString='{"AccessTokensTable":"'"${DEPLOYMENT}"'-AccessTokensTable"}'
export ICEBERG_NAMESPACE=${bamboo_ICEBERG_NAMESPACE}

echo "*** Bootstrapping dependencies"
npm install --ignore-scripts --no-package-lock
npm run ci:bootstrap-no-scripts

export PORT=5001
export FAKE_AUTH=true
export TOKEN_SECRET=test-secret-12345

echo "*** Starting Server"
node packages/api/app/iceberg-index.js > iceberg-server-debug.log 2>&1 &
SERVER_PID=$!

echo "*** Waiting for server health check on port ${PORT}..."
MAX_ATTEMPTS=45
ATTEMPT=0
while ! curl -s http://localhost:${PORT}/health | grep -q 'Ready'; do
  if (( ATTEMPT >= MAX_ATTEMPTS )); then
    echo 'Server failed to start in time! Server logs:'
    cat iceberg-server-debug.log
    kill $SERVER_PID
    exit 1
  fi
  sleep 2
  ATTEMPT=$((ATTEMPT+1))
done

echo "*** Running Iceberg API integration test (AVA)"
./node_modules/.bin/ava packages/api/tests/docker/test-iceberg-api.js --timeout=5m

# Cleanup
echo "*** Shutting down server"
kill $SERVER_PID
