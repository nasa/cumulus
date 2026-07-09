#!/bin/bash

# This script runs the initial setup of the replication (if needed) and starts the compactor
set -e

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Runs the initial setup of the replication (if needed) and starts the compactor.

Options:
  -h                 Show this help message and exit

Environment Variables:
  PG_HOST                 (required) The endpoint of the RDS Postgres cluster
  PG_PORT                 (optional) The port for the RDS Postgres cluster - default 5432
  PG_DB                   (required) The Postgres database, e.g., `postgres`
  PG_ADMIN_LOGIN_CREDS    (required) A JSON string containing `user` and `password` fields for PG admin user
  TABLES                  (required) Comma-separated list of tables to be replicated
  AWS_DEFAULT_REGION      (required) The AWS region the replication runs in
  ICEBERG_NAMESPACE       (required) The namespace for the Iceberg table(s)
  ICEBERG_S3_BUCKET       (required) The name of the S3 bucket where the Iceberg tables are stored
  SLOT_NAME               (required) The name of the Postgres replication slot for the specified table(s)
  COMPACTION_INTERVAL_SEC (optional) The delay in seconds between compactions - default 30

Examples:
  $(basename "$0")              # Build with tag 'latest'
  $(basename "$0") 1.2.3        # Build with tag '1.2.3'
EOF
}

parse_credentials() {
    local json="$1"

    export USER=$(echo "$json" | jq -r '.username')
    export PASSWORD=$(echo "$json" | jq -r '.password')
}

if [[ "$1" == "-h" ]]; then
    usage
    exit 0
fi

REQUIRED_VARS=(
    "PG_HOST"
    "PG_DB"
    "PG_ADMIN_LOGIN_CREDS"
    "TABLES"
    "AWS_DEFAULT_REGION"
    "ICEBERG_NAMESPACE"
    "ICEBERG_S3_BUCKET"
    "SLOT_NAME"
)

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "❌ Error: The following environment variables are empty:"
    for missing in "${MISSING_VARS[@]}"; do
        echo "  - $missing"
    done
    exit 1
fi

export PG_PORT=${PG_PORT:-5432}
export PG_SCHEMA=${PG_SCHEMA:-public}
export COLUMN_EXCLUDE_LIST=${COLUMN_EXCLUDE_LIST:-""}
export TABLES
export SLOT_NAME
export SPARK_JARS_DIR=./scripts/jars
export JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=./spark-tmp"
export COMPACTION_INTERVAL_SEC=${COMPACTION_INTERVAL_SEC:-30}

parse_credentials $PG_ADMIN_LOGIN_CREDS

export PG_USER="$USER"
export PG_PASSWORD="$PASSWORD"

# Check for bucket and create it if it does not exist

if aws s3api head-bucket --bucket "$ICEBERG_S3_BUCKET" --region "$AWS_DEFAULT_REGION" 2>/dev/null; then
  echo "Bucket '$ICEBERG_S3_BUCKET' already exists."
else
  echo "Bucket '$ICEBERG_S3_BUCKET' does not exist. Creating..."

  # us-east-1 doesn't accept a LocationConstraint
  if [ "$AWS_DEFAULT_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$ICEBERG_S3_BUCKET" --region "$AWS_DEFAULT_REGION"
  else
    aws s3api create-bucket \
      --bucket "$ICEBERG_S3_BUCKET" \
      --region "$AWS_DEFAULT_REGION" \
      --create-bucket-configuration LocationConstraint="$AWS_DEFAULT_REGION"
  fi

  echo "Bucket '$ICEBERG_S3_BUCKET' created in region '$AWS_DEFAULT_REGION'."
fi

# Configure Postgres for replication
export PGPASSWORD="$PASSWORD"

echo "Connecting to $PG_HOST:$dbport/$PG_DB as $USER..."

TABLE_LIST=$(echo "$TABLES" | tr ',' '\n' | sed "s/^[[:space:]]*//" | sed "s/[[:space:]]*$//" | paste -sd ',' -)

echo "SLOT_NAME: $SLOT_NAME"
echo "$TABLE_LIST"
echo "Publication name: ${SLOT_NAME}_dbz_publication"

echo "PSQL VERSION: $(psql --version)"

psql \
  --host="$PG_HOST" \
  --port="$PG_PORT" \
  --dbname="$PG_DB" \
  --username="$USER" \
  --single-transaction \
  <<EOF
CREATE EXTENSION IF NOT EXISTS pglogical;
GRANT rds_replication TO $USER;
GRANT USAGE ON SCHEMA pglogical TO $USER;
EOF

psql \
  --host="$PG_HOST" \
  --port="$PG_PORT" \
  --dbname="$PG_DB" \
  --username="$USER" \
  -c "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = '${SLOT_NAME}_dbz_publication') THEN
      EXECUTE 'CREATE PUBLICATION ${SLOT_NAME}_dbz_publication FOR TABLE ${TABLE_LIST} WITH (publish_via_partition_root = true)';
    END IF;
  END \$\$;"


# Wait for the kafka-connect container to be ready
until curl -sf http://localhost:8083/; do
  echo "Waiting for Kafka Connect..."
  sleep 5
done

API_URL="http://localhost:8083/connectors"
export CONNECTOR_NAME="${SLOT_NAME}-connector"
sink_name_prefix="small_tables"
if [[ "$SLOT_NAME" =~  ^.*files ]]; then
  sink_name_prefix="files"
elif [[ "$SLOT_NAME" =~ ^.*granules ]]; then
  sink_name_prefix="granules"
elif [[ "$SLOT_NAME" =~ ^.*executions ]]; then
  sink_name_prefix="executions"
fi

sink_json="./resources/${sink_name_prefix}_sink.json"
export SINK_CONNECTOR_NAME="ice-$sink_name_prefix"

echo "🗑️  Deleting existing source connector: $CONNECTOR_NAME..."
DELETE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/$CONNECTOR_NAME")

if [ "$DELETE_STATUS" == "404" ]; then
    echo "⚠️  Source connector didn't exist, proceeding to creation."
else
    echo "✅ Successfully deleted existing source connector."
fi

# Create source connector
echo "Creating source connector $CONNECTOR_NAME..."
envsubst < ./resources/source_connector.json.template | curl -i -X POST \
  -H "Accept:application/json" \
  -H "Content-Type:application/json" \
  "$API_URL" \
  -d @-

# Create Iceberg table and populate it from postgres table
echo "Running bulk load script"
python3 ./scripts/bulk_load_self_managed_iceberg.py --compact

# Start the sink process in the background
echo "Creating sink process $SINK_CONNECTOR_NAME..."
SINK_PID=""

cleanup() {
    echo "Shutting down..."
    if [ -n "$SINK_PID" ] && kill -0 "$SINK_PID" 2>/dev/null; then
        echo "Stopping sink process (PID $SINK_PID)..."
        kill "$SINK_PID"
        wait "$SINK_PID" 2>/dev/null || true
        echo "Sink process stopped."
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

envsubst < "$sink_json" > sink.json
python3 ./scripts/sink.py --config sink.json &
SINK_PID=$!

# Wait for the sink to be ready
until curl -sf http://localhost:8080/status | grep -q '"state": "RUNNING"'; do
  echo "Waiting for sink to be ready..."
  sleep 2
done

# Start compactor (runs in foreground, keeping the script alive)
echo "Starting compactor"
python3 ./scripts/iceberg_compact.py --namespace "$ICEBERG_NAMESPACE" \
--table "$TABLES" \
--warehouse "s3://${ICEBERG_S3_BUCKET}/warehouse" \
--region "$AWS_DEFAULT_REGION" \
--jars-dir "./scripts/jars" \
--kafka-connect-url "http://localhost:8080" \
--connector-name "$SINK_CONNECTOR_NAME" \
--interval $COMPACTION_INTERVAL_SEC
