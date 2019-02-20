#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

cd example || exit 1
yarn

echo Unlocking stack
node ./scripts/lock-stack.js false $DEPLOYMENT