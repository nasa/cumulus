#!/bin/bash

REQUIRED_VARS=(
    "PG_HOST"
    "PG_USER"
    "PG_PASSWORD"
    "PG_DB"
    "REPL_SLOT_PREFIX"
)

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "❌ Error: The following environment variables are empty in .env:"
    for missing in "${MISSING_VARS[@]}"; do
        echo "  - $missing"
    done
    exit 1
fi

CONNECTOR_NAME="pg-source-executions"
API_URL="http://localhost:8083/connectors"
TEMPLATE_FILE="source_connector_config.json"

echo "🗑️  Deleting existing source connector: $CONNECTOR_NAME..."
DELETE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/$CONNECTOR_NAME")

if [ "$DELETE_STATUS" == "404" ]; then
    echo "⚠️  Connector didn't exist, proceeding to creation."
else
    echo "✅ Successfully deleted existing connector."
fi

echo "🚀 Injecting variables and recreating source connector..."

# envsubst processes the template, then we POST it to Kafka Connect
# The -d @- tells curl to read the body from the pipe (stdin)
RESPONSE=$(envsubst < "$TEMPLATE_FILE" | curl -s -X POST "$API_URL" \
     -H "Content-Type: application/json" \
     -d @-)

if [[ $RESPONSE == *"error_code"* ]]; then
    echo "❌ Failed to create connector. Response:"
    echo "$RESPONSE"
    exit 1
else
    echo "✅ Connector '$CONNECTOR_NAME' created successfully."
fi
