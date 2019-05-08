#!/bin/bash
set -e
. ./bamboo/set-integration-test-env-variables.sh
if [[ $PULL_REQUEST = "false" ]]; then
  echo "******Skipping integration tests as this commit is not a PR"
  exit(0)
fi
(cd example && npm test)