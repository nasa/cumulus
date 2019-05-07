#!/bin/sh

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
  set -e

  cd example

  # Wait for the stack to be available
  LOCK_EXISTS_STATUS=$(node ./scripts/lock-stack.js true $DEPLOYMENT)

  echo "Locking status $LOCK_EXISTS_STATUS"

  while [ "$LOCK_EXISTS_STATUS" = 1 ]; do
    echo "Another build is using the ${DEPLOYMENT} stack."
    sleep 30

    LOCK_EXISTS_STATUS=$(node ./scripts/lock-stack.js true $DEPLOYMENT)
  done

  ./node_modules/.bin/kes cf deploy \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/iam

  ./node_modules/.bin/kes cf deploy \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/db

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
