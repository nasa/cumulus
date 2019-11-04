#!/bin/bash

set -ex
source .bamboo_env_vars || true
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh

if [[ $REPORT_BUILD_STATUS == true ]]; then
  ### Post status to github.  Requires set-bamboo-env-variables to have been set.
  curl -H\
  "Authorization: token $GITHUB_TOKEN"\
   -d "{\"state\":\"$1\", \"target_url\": \"$2\", \"description\": \"$3\", \"context\": \"earthdata-bamboo\"}"\
   -H "Content-Type: application/json"\
   -X POST\
   https://api.github.com/repos/nasa/cumulus/statuses/$GIT_SHA
fi
