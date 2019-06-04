#!/bin/bash
set -e
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh
. ./bamboo/set-bamboo-env-variables.sh

if [[ $USE_NPM_PACKAGES == true ]]; then
  echo "***Running integration tests from NPM packages"
  (cd example && npm install)
else
  echo "***Running integration tests from bootstrapped packages"
  npm install && npm run bootstrap
fi
cd example && npm test