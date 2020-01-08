#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
npm install
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-skip-integration-tests.sh

echo "cleanup-integration-tests.sh is depricated"