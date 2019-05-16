#!/bin/bash
set -e
. ./bamboo/set-bamboo-env-variables.sh
if [[ $RUN_REDEPLOYMENT != true ]]; then
  >&2 echo "***Skipping redeploy tests***"
  exit 0
fi

(cd example && npm run redeploy-test)
