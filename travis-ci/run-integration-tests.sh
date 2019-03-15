#!/bin/sh

set -e

npm ci
. ./travis-ci/set-env-vars.sh

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  (cd example && npm ci)
else
  npm run bootstrap
fi

(cd example && npm test)
