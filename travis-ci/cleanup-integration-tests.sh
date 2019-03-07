#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

cd example

# Delete the stack if it's a nightly build
if [ "$DEPLOYMENT" = "cumulus-nightly" ]; then
  npm ci
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
else
  npm install @cumulus/common
fi

echo Unlocking stack
node ./scripts/lock-stack.js false "$DEPLOYMENT"
