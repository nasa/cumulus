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

# This should be able to go away once latest is released
if [ "$USE_NPM_PACKAGES" = "true" ]; then
  yarn
else
  ./bin/prepare
fi

cd example || exit 1

# Delete the stack if it's a nightly build
if [ "$DEPLOYMENT" = "cumulus-nightly" ]; then
  npm install

  echo Delete app deployment

  ./node_modules/.bin/kes cf delete \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --yes

  echo Delete iam deployment

  ./node_modules/.bin/kes cf delete \
    --kes-folder iam \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --yes

  echo Delete app deployment
fi

echo Unlocking stack
node ./scripts/lock-stack.js false $DEPLOYMENT