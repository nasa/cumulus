#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-skip-integration-tests.sh

set +e
(
  set -e

  cd example
  rm -rf node_modules

    # Prevents breaking on a release build when it tries to install
    # the version that does not exist
    # We only need the common package for the lock-stack script
    # npm install @cumulus/common@1.17.0
    # Update post release of aws-client
)
RESULT=$?
set -e

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
(npm run bootstrap-no-build && npm run bootstrap-no-build && cd example && node ./scripts/lock-stack.js lock $GIT_SHA $DEPLOYMENT false)

exit $RESULT
