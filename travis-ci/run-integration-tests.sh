#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  (set -e && cd example && npm ci)
else
  ./travis-ci/fetch-cache.sh
  ln -s /dev/stdout ./lerna-debug.log
  lerna link
fi

(set -e && cd example && npm test)
