#!/bin/bash
set -e

source .bamboo_env_vars || true
if [[ $COMMIT_MESSAGE =~ skip-integration-tests || $SKIP_INTEGRATION_TESTS == true ]]; then
  >&2 echo "******Skipping integration tests based on commit message: $COMMIT_MESSAGE"
  exit 0
fi
