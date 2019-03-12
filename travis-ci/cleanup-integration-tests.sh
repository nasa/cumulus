#!/bin/sh

set -evx

. ./travis-ci/set-env-vars.sh

(
  set -evx
  cd example

  rm -rf node_modules

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

  echo Unlocking stack
  node ./scripts/lock-stack.js false $DEPLOYMENT
)
