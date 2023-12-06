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
npx lerna bootstrap --scope @cumulus/cumulus-integration-tests --scope @cumulus/aws-client --scope @cumulus/checksum --scope @cumulus/common --scope @cumulus/errors --scope @cumulus/logger
cd example/cumulus-tf && terraform destroy

cd .. && node ./scripts/lock-stack.js lock "$GIT_SHA" "$DEPLOYMENT" false