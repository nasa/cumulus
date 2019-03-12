#!/bin/sh

set -evx

. ./travis-ci/set-env-vars.sh

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
else
  npm install @cumulus/common
fi

pwd
ls -l node_modules/
ls -l node_modules/@cumulus/
ls -l node_modules/@cumulus/common/
ls -l node_modules/@cumulus/common/node_modules/

echo Unlocking stack
node ./scripts/lock-stack.js false $DEPLOYMENT
