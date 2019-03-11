#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

(
  set -e

  cd example
  npm install

  echo Unlocking stack
  node ./scripts/lock-stack.js false $DEPLOYMENT
)
