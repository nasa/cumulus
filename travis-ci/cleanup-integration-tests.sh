#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

# This should be able to go away once latest is released
if [ "$USE_NPM_PACKAGES" = "true" ]; then
  yarn
else
  ./bin/prepare
fi

cd example || exit 1

./travis-ci/cleanup-stack.sh