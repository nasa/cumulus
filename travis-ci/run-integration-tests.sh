#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  (cd example && rm -rf node_modules && npm install)
else
  npm run bootstrap
fi

(cd example && npm test)
