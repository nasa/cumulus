#!/bin/bash
set -ex
. ./bamboo/set-bamboo-env-variables.sh

echo "Locking stack for deployment $DEPLOYMENT"
cd example
set +e

.  ./bamboo/setup_python_environment.sh
# Wait for the stack to be available
node ./scripts/lock-stack.js lock "$GIT_SHA" "$DEPLOYMENT" true
LOCK_EXISTS_STATUS=$?
echo "Locking status $LOCK_EXISTS_STATUS"

COUNTER=0
while [[ $LOCK_EXISTS_STATUS == 100 ]]; do
  if [[ $COUNTER -gt $TIMEOUT_PERIODS ]]; then
    echo "Timed out waiting for stack to become available"
    exit 1
  fi
  echo "Another build is using the ${DEPLOYMENT} stack."
  sleep 30
  ((COUNTER++))
  node ./scripts/lock-stack.js lock "$GIT_SHA" "$DEPLOYMENT" true
  LOCK_EXISTS_STATUS=$?
done
if [[ $LOCK_EXISTS_STATUS -gt 0 ]]; then
  exit 1
fi

set -e
echo "Running Terraform deployment $DEPLOYMENT"

. ../bamboo/bootstrap-tf-deployment.sh

