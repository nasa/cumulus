#!/bin/sh

set -e

export AWS_ACCESS_KEY_ID="$INTEGRATION_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$INTEGRATION_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$INTEGRATION_AWS_DEFAULT_REGION"

if [ -z "$DEPLOYMENT" ]; then
  DEPLOYMENT=$(node ./travis-ci/select-stack.js)
  if [ "$DEPLOYMENT" = "none" ]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
fi
export DEPLOYMENT

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  yarn
else
  ./bin/prepare
fi

echo "Locking stack for deployment $DEPLOYMENT"

# Wait for the stack to be available
cd example
# LOCK_EXISTS_STATUS=$(node ./scripts/lock-stack.js true $DEPLOYMENT)

# echo "Locking status $LOCK_EXISTS_STATUS"

# while [ "$LOCK_EXISTS_STATUS" = 1 ]; do
#   echo "Another build is using the ${DEPLOYMENT} stack."
#   sleep 30

#   LOCK_EXISTS_STATUS=$(node ./scripts/lock-stack.js true $DEPLOYMENT)
# done

(
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
)

exit
