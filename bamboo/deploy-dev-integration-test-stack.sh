#!/bin/bash
set -ex

. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh

if [[ $USE_TERRAFORM_ZIPS == true ]]; then
  ## If this flag is set, we want to use the output of the 'publish' stage
  ## to deploy in the integration test stage, so abort
  exit 0;
fi

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  ## Change into cached cumulus, pull down /cumulus ref and run there
  echo "*** Using cached bootstrap"
  cd /cumulus/
  git fetch --all
  git checkout "$GIT_SHA"
fi
echo "***Deploying stack with built source"

# Extract cache of compiled TS files
./bamboo/extract-ts-build-cache.sh

npm install
## Double bootstrapping required as workaround to
## lerna re-bootstrapping issue in older releases
## (similiar to  https://github.com/lerna/lerna/issues/1457)
(npm run ci:bootstrap-no-scripts || true) && npm run ci:bootstrap

npm run package

. ./bamboo/deploy-integration-stack.sh
