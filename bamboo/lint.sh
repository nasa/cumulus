#!/bin/bash
set -ex
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh

  # If flag is set, use container-cached bootstrap env
 if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
    echo "*** Using cached bootstrap"
    cd /cumulus/
 fi

(npm run ci:bootstrap-no-scripts || true) && npm run ci:bootstrap-no-scripts
npm run lint

GIT_DIFF=$(git --no-pager diff --name-only $BRANCH:CHANGELOG.md -- CHANGELOG.md)
if [[ ! $SKIP_CHANGELOG == "true" || ! $GIT_DIFF =~ ^CHANGELOG.md$ ]]; then
  echo "**** ERROR -- NO CHANGELOG CHANGE DETECTED.  Failing Lint...."
  echo "GIT DIFF OUTPUT was $GIT_DIFF"
  exit 1
fi
