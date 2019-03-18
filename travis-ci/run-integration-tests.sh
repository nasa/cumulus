#!/bin/sh

set -e

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  (cd example && rm -rf node_modules && npm install)
else
  npm install
  npm run bootstrap
fi

. ./travis-ci/set-env-vars.sh

(cd example && npm test)
