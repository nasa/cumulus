#!/bin/bash
set -ex
. ./bamboo/abort-if-skip-integration-tests.sh
source .bamboo_env_vars || true

if [[ $RUN_REDEPLOYMENT != true ]]; then
  >&2 echo "***Skipping redeploy tests***"
  exit 0
fi

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus dir
  echo "*** Using cached bootstrap build dir"
  cd /cumulus/
fi

. ./bamboo/set-bamboo-env-variables.sh

(cd example && npm run redeploy-test)
