#!/bin/bash

set -e

npm install

. ./travis-ci/set-env-vars.sh

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  (cd example && npm install)
else
  npm run bootstrap
fi

echo "Locking stack for deployment $DEPLOYMENT"
(
  cd example
  set +e
  # Wait for the stack to be available
  node ./scripts/lock-stack.js true $DEPLOYMENT
  LOCK_EXISTS_STATUS=$?
  echo "Locking status $LOCK_EXISTS_STATUS"

  while [[ $LOCK_EXISTS_STATUS = 100 ]]; do
    echo "Another build is using the ${DEPLOYMENT} stack."
    sleep 30
    node ./scripts/lock-stack.js true $DEPLOYMENT
    LOCK_EXISTS_STATUS=$?
  done
  if [[ $LOCK_EXIST_STATUS -gt 0 ]]; then
    echo "FAILURE - Exiting due to failure in lock-stack.js"
    exit 1;
  fi

  set -e
  ./node_modules/.bin/kes cf deploy \
    --kes-folder iam \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/iam

  ./node_modules/.bin/kes cf deploy \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/app

  ./node_modules/.bin/kes lambda S3AccessTest deploy \
    --kes-folder app \
    --template node_modules/@cumulus/deployment/app \
    --deployment "$DEPLOYMENT" \
    --region us-west-2
)
