#!/bin/bash
set -e
. ./bamboo/set-integration-test-env-variables.sh
if [[ $PULL_REQUEST = "false" ]]; then
  echo "******Skipping integration tests as this commit is not a PR"
fi

if [[ $BRANCH == master || $VERSION_TAG || COMMIT_MESSAGE =~ '[run-redeploy-tests]' ]]; then
  (cd example && npm run redeploy-test)
else
  echo "***Skipping redeploy tests***"
fi