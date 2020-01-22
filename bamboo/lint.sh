#!/bin/bash
set -ex
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh

  # If flag is set, use container-cached bootstrap env
 if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
    echo "*** Using cached bootstrap"
    cd /cumulus/
    npm run bootstrap-no-build --concurrency 1 && npm run bootstrap-no-build --concurrency 1
 else
    npm run bootstrap-no-build && npm run bootstrap-no-build
 fi

npm run lint-md
npm run lint
