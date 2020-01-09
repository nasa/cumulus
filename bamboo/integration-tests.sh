#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-skip-integration-tests.sh

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus dir
  echo "*** Using cached bootstrap build dir"
  cd /cumulus/
fi

cd example && npm test