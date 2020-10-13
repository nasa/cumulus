#!/bin/bash
set -ex
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh

  # If flag is set, use container-cached bootstrap env
 if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
    echo "*** Using cached bootstrap"
    cd /cumulus/
 fi

(npm run bootstrap-no-build-ci || true) && npm run bootstrap-no-build-ci
npm run lint
