#!/bin/bash
set -ex
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh

  # If flag is set, use container-cached bootstrap env
 if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
    echo "*** Using cached bootstrap"
    cd /cumulus/
 fi

# Extract cache of compiled TS files
./bamboo/extract-ts-build-cache.sh

(npm run ci:bootstrap-no-scripts || true) && npm run ci:bootstrap-no-scripts
npm run lint

if [[ $SKIP_CHANGELOG != "true" && ! $(git --no-pager diff --name-only origin/$PR_BRANCH:CHANGELOG.md -- CHANGELOG.md) =~ ^CHANGELOG.md$ ]]; then
  echo "**** ERROR -- NO CHANGELOG CHANGE DETECTED.  Failing Lint...."
  echo "GIT DIFF OUTPUT: $GIT_DIFF"
  exit 1
fi
