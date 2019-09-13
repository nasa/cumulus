#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh
. ./bamboo/set-bamboo-env-variables.sh

if [[ $DEPLOYMENT =~ '-tf' ]]; then
  echo "Running migrated terraform-compatible tests."
  . ./bamboo/integration-tests-terraform.sh
else
  echo "Running kes-compatible full test suite."
  cd example && npm test
fi
