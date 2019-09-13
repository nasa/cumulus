#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh
. ./bamboo/abort-if-not-terraform.sh
. ./bamboo/set-bamboo-env-variables.sh

# Eventual goal
# cd example && npm test

# Add individual integration tests to be run here.
# cd example && npx jasmine spec/someTestSpec.js
