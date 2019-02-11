#!/bin/sh

set -e

sh set-env-vars.sh

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