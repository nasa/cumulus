#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh

npm config set unsafe-perm true
. ./bamboo/set-bamboo-env-variables.sh

if [[ $USE_TERRAFORM_ZIPS == true ]]; then
  # If this flag is set, we don't want to deploy until *after* publish occurs
  exit 0;
fi

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus, pull down /cumulus ref and run there
  echo "*** Using cached bootstrap"
  cp .bamboo_env_vars /cumulus/
  cd /cumulus/
  git fetch --all
  git checkout "$GIT_SHA"
fi
echo "***Deploying stack with built source"
npm install
npm run bootstrap-no-build && npm run bootstrap-no-build
npx lerna run prepare

. ./bamboo/deploy-integration-stack.sh
