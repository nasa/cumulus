#!/bin/bash
set -ex
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh

npm config set unsafe-perm true

if [[ $USE_TERRAFORM_ZIPS == true ]]; then
  ## Configure TF deployment to use deployed packages for the version being built
  echo "***Deploying stack with deployment packages"

  ## Update cumulus-tf
  cd example/cumulus-tf
  # Update to use workflow module
  sed -i "s/source = \"..\/..\/tf-modules\/workflow/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus-workflow.zip\/\//g" *.tf
  # Update to use ecs service module
  sed -i "s/source = \"..\/..\/tf-modules\/cumulus_ecs_service/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus-ecs-service.zip\/\//g" *.tf
  # Update to use cumulus core module
  sed -i "s/source = \"..\/..\/tf-modules\/cumulus/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus.zip\/\/tf-modules\/cumulus/g" *.tf

  ## Update data-persistence
  cd ../data-persistence-tf
  sed -i "s/source = \"..\/..\/tf-modules\/data-persistence/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus.zip\/\/tf-modules\/data-persistence/g" *.tf

  ## Prepare repo lambdas
  cd ..
  npm install && npm run prepare
  cd ..
else
  echo "***Bootstrapping integration tests with source"
  ## Deployment was done in the deploy-dev-integration-test-stack.sh script in a
  ## prior job.    Run bootstrap only to cross link dependencies for the
  ## int tests, then exit before deploying
  if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus dir
    echo "*** Using cached bootstrap build dir"
    cd /cumulus/
    git fetch --all
    git checkout "$GIT_SHA"
  fi
  npm install
  ## Double bootstrapping required as workaround to
  ## lerna re-bootstrapping issue in older releases
  ## (similiar to  https://github.com/lerna/lerna/issues/1457)
  (npm run bootstrap-no-build || true) && npm run bootstrap-no-build
  exit 0
fi

. ./bamboo/deploy-integration-stack.sh

