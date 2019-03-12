#!/bin/sh

set -evx

. ./travis-ci/set-env-vars.sh

(
  set -evx

  cd example
  rm -rf node_modules
  npm install @cumulus/common

  echo Unlocking stack
  node ./scripts/lock-stack.js false $DEPLOYMENT
)
