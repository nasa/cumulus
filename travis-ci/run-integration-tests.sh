#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  (set -e && cd example && npm install)
else
  npm bootstrap
fi

(set -e && cd example && npm test)
