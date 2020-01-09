#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh

npm config set unsafe-perm true
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-skip-integration-tests.sh

if [[ $USE_TERRAFORM_ZIPS == true ]]; then
  npm install
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
  if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus dir
    echo "*** Using cached bootstrap build dir"
    cd /cumulus/
    git fetch --all
    git checkout "$GIT_SHA"
  fi
  npm install
  npm run bootstrap-no-build && npm run bootstrap-no-build
  exit 0
fi

. ./bamboo/deploy-integration-stack.sh

