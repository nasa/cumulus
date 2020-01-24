#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-skip-integration-tests.sh

echo Unlocking stack

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus, pull down /cumulus ref and run there
    echo "*** Using cached bootstrap"
    cp .bamboo_env_vars /cumulus/
    cd /cumulus/
    git fetch --all
    git checkout "$GIT_SHA"
    rm package-lock.json || true
fi
npm install --ignore-scripts --no-package-lock
npm --version
(npm run bootstrap-no-build && npm run bootstrap-no-build && cd example && node ./scripts/lock-stack.js lock $GIT_SHA $DEPLOYMENT false)
exit $RESULT
