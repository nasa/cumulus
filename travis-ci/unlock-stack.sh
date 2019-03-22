#!/bin/sh

set -e

npm ci
. ./travis-ci/set-env-vars.sh

(
  set -e

  cd example
  rm -rf node_modules
  npm install @cumulus/common

  echo Unlocking stack
  node ./scripts/lock-stack.js false $DEPLOYMENT
)
