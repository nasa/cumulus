#!/bin/bash
set -e
# This script runs before lint.sh, audit.sh in the agent container
. ./bamboo/abort-if-not-pr.sh
. ./bamboo/set-bamboo-env-variables.sh

  # If flag is set, use container-cached bootstrap env
 if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
    echo "*** Using cached bootstrap directory"
    cd /cumulus/
 fi

 if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus, pull down /cumulus ref and run there
    echo "*** Using cached bootstrap"
    cd /cumulus/
    git fetch --all
    git checkout "$GIT_SHA"
  fi

npm run bootstrap-no-build

npm install -g npm
ln -s /dev/stdout ./lerna-debug.log
npm install --no-audit
