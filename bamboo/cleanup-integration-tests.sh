#!/bin/bash
# shellcheck disable=SC1091

set -ex
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh

echo Unlocking stack

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus, pull down /cumulus ref and run there
    echo "*** Using cached bootstrap"
    cp .bamboo_env_vars /cumulus/
    cd /cumulus/
    git fetch --all
    git checkout "$GIT_SHA"
fi
npm install
npm --version

## This is needed to ensure lock-stack has the expected dependencies
npm install -w @cumulus/cumulus-integration-tests -w @cumulus/aws-client -w @cumulus/checksum -w @cumulus/common -w @cumulus/errors -w @cumulus/logger

cd example && node ./scripts/lock-stack.js lock "$GIT_SHA" "$DEPLOYMENT" false
