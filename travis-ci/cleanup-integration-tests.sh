#!/bin/sh

set -e

npm ci
. ./travis-ci/set-env-vars.sh

set +e
(
  set -e

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

    echo Delete app deployment
  else
    rm -rf node_modules

    # Needed functionality is in 1.11.3
    # Prevents breaking on a release build when
    npm install @cumulus/common@1.11.3
  fi
)
RESULT=$?
set -e

echo Unlocking stack
(cd example && node ./scripts/lock-stack.js false $DEPLOYMENT)

exit $RESULT
