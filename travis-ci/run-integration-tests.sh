#!/bin/sh

set -e

npm install
. ./travis-ci/set-env-vars.sh

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  (cd example && npm install)
else
  npm run bootstrap
fi

(cd example && npm test)
