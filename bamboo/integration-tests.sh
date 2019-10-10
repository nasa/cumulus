#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-terraform-branch.sh


cd example && npm test