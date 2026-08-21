#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------------------
# Validate Required Environment Variables
# ------------------------------------------------------------------------------
: "${TABLE_NAME:?Environment variable TABLE_NAME must be set}"
: "${CLEANUP_ROLE_NAME:?Environment variable CLEANUP_ROLE_NAME must be set}"
: "${ICEBERG_S3_BUCKET:?Environment variable ICEBERG_S3_BUCKET must be set}"
: "${ICEBERG_NAMESPACE:?Environment variable ICEBERG_NAMESPACE must be set}"
: "${ORPHAN_OLDER_THAN_DAYS:?Environment variable ORPHAN_OLDER_THAN_DAYS must be set}"


# Location to write output from Athena queries
ATHENA_OUTPUT_LOCATION="s3://$ICEBERG_S3_BUCKET/athena-results"


# ------------------------------------------------------------------------------
# Fetch AWS Account ID
# ------------------------------------------------------------------------------
echo "Fetching AWS Account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: ${ACCOUNT_ID}"

CLEANUP_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${CLEANUP_ROLE_NAME}"

# ------------------------------------------------------------------------------
# Step 1: Start Athena Query Execution
# ------------------------------------------------------------------------------
echo "Updating Iceberg table properties via Athena..."
# Need to lower the property to the max that the table optimizer will allow
QUERY_STRING="ALTER TABLE ${ICEBERG_NAMESPACE}.${TABLE_NAME} SET TBLPROPERTIES ('write_target_data_file_size_bytes' = '536870912');"

echo "Executing query ${QUERY_STRING} for catalog ${ACCOUNT_ID}"

CMD=(
  aws athena start-query-execution
  --query-string "${QUERY_STRING}"
  --query-execution-context "Database=${ICEBERG_NAMESPACE},Catalog=${ACCOUNT_ID}"
  --query "QueryExecutionId"
  --output text
  --result-configuration "OutputLocation=${ATHENA_OUTPUT_LOCATION}"
)

QUERY_EXEC_ID=$("${CMD[@]}")
echo "Query started with Execution ID: ${QUERY_EXEC_ID}"

# ------------------------------------------------------------------------------
# Step 2: Poll Athena Query Status until SUCCEEDED
# ------------------------------------------------------------------------------
echo "Waiting for Athena query to complete..."

while true; do
  STATUS=$(aws athena get-query-execution \
    --query-execution-id "${QUERY_EXEC_ID}" \
    --query "QueryExecution.Status.State" \
    --output text)

  case "${STATUS}" in
    SUCCEEDED)
      echo "Athena query succeeded!"
      break
      ;;
    FAILED|CANCELLED)
      REASON=$(aws athena get-query-execution \
        --query-execution-id "${QUERY_EXEC_ID}" \
        --query "QueryExecution.Status.StateChangeReason" \
        --output text)
      echo "Error: Athena query ended with status '${STATUS}'. Reason: ${REASON}" >&2
      exit 1
      ;;
    QUEUED|RUNNING)
      echo "Query status is '${STATUS}'... waiting 3 seconds."
      sleep 3
      ;;
    *)
      echo "Unknown query status '${STATUS}'... waiting 3 seconds."
      sleep 3
      ;;
  esac
done

# ------------------------------------------------------------------------------
# Step 3: Create Glue Table Optimizer (Ignore AlreadyExistsException)
# ------------------------------------------------------------------------------
echo "Configuring Glue Table Optimizer for orphan file deletion..."

OPTIMIZER_CONFIG=$(cat <<EOF
{
  "roleArn": "${CLEANUP_ROLE_ARN}",
  "enabled": true,
  "orphanFileDeletionConfiguration": {
    "icebergConfiguration": {
      "orphanFileRetentionPeriodInDays": ${ORPHAN_OLDER_THAN_DAYS},
      "runRateInHours": 3
    }
  }
}
EOF
)

# Run create-table-optimizer and capture stdout/stderr
if OUTPUT=$(aws glue create-table-optimizer \
  --catalog-id "${ACCOUNT_ID}" \
  --database-name "${ICEBERG_NAMESPACE}" \
  --table-name "${TABLE_NAME}" \
  --table-optimizer-configuration "${OPTIMIZER_CONFIG}" \
  --type orphan_file_deletion 2>&1); then
    echo "Table optimizer created successfully!"
else
    # Check if the failure was due to AlreadyExistsException
    if echo "${OUTPUT}" | grep -q "AlreadyExistsException"; then
        echo "Table optimizer already exists. Proceeding..."
    else
        echo "Failed to create table optimizer:" >&2
        echo "${OUTPUT}" >&2
        exit 1
    fi
fi

echo "All steps completed successfully!"
