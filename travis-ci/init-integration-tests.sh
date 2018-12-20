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

# Wait for the stack to be available
cd example
LOCK_EXISTS_STATUS=$(node ./scripts/lock-stack.js $DEPLOYMENT true)

while [ "$LOCK_EXISTS_STATUS" = "false" ]; do
  echo "Another build is using the ${DEPLOYMENT} stack."
  sleep 30

  LOCK_EXISTS_STATUS=$(node ./scripts/lock-stack.js $DEPLOYMENT true)
done

(
  if [ "$USE_NPM_PACKAGES" = "true" ]; then
    yarn
  else
    (cd .. && ./bin/prepare)
  fi

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
