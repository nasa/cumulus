#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh

npm config set unsafe-perm true
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-skip-integration-tests.sh

if [[ $USE_TERRAFORM_ZIPS == true ]]; then
  # If this flag is set, we don't want to deploy until *after* publish occurs
  exit 0;
fi

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus, pull down /cumulus ref and run there
  echo "*** Using cached bootstrap"
  cd /cumulus/
  git fetch --all
  git checkout "$GIT_SHA"
fi
echo "***Deploying stack with built source"
npm install
npm run bootstrap-no-build && npm run bootstrap-no-build
npx lerna run prepare

. ./bamboo/deploy-integration-stack.sh
