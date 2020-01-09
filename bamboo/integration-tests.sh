#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-skip-integration-tests.sh

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus dir
  echo "*** Using cached bootstrap build dir"
  cd /cumulus/
fi

npm install
npm run bootstrap-no-build && npm run bootstrap-no-build

cd example && npm test