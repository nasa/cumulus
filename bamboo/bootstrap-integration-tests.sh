#!/bin/bash
set -ex
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh

if [[ $USE_TERRAFORM_ZIPS == true ]]; then
  ## Configure TF deployment to use deployed packages for the version being built
  echo "***Deploying stack with deployment packages"

  npm install
  ## This is needed to ensure lock-stack has the expected dependencies
  npx lerna run build --scope @cumulus/cumulus-integration-tests --scope @cumulus/aws-client --scope @cumulus/checksum --scope @cumulus/common --scope @cumulus/errors --scope @cumulus/logger

  ## Update cumulus-tf
  cd example/cumulus-tf
  # Update to use workflow module
  sed -i "s/source[ ]*= \"..\/..\/tf-modules\/workflow/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus-workflow.zip\/\//g" *.tf
  # Update to use ecs service module
  sed -i "s/source[ ]*= \"..\/..\/tf-modules\/cumulus_ecs_service/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus-ecs-service.zip\/\//g" *.tf
  # Update to use cumulus core module
  sed -i "s/source[ ]*= \"..\/..\/tf-modules\/cumulus/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus.zip\/\/tf-modules\/cumulus/g" *.tf

  ## [MHS, 04/29/2021] fix cumulus_distribution package not released separately.
  sed -i "s/source[ ]*= \"..\/..\/tf-modules\/cumulus_distribution\"/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus.zip\/\/tf-modules\/cumulus_distribution\"/g" *.tf
  # Update to use distribution module
  sed -i "s/source[ ]*= \"..\/..\/tf-modules\/distribution/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus.zip\/\/tf-modules\/distribution/g" *.tf

  ## Update data-persistence
  cd ../data-persistence-tf
  sed -i "s/source[ ]*= \"..\/..\/tf-modules\/data-persistence/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus.zip\/\/tf-modules\/data-persistence/g" *.tf
  # Update db-provision-user-database source
  sed -i "s/source[ ]*= \"..\/..\/lambdas\/db-provision-user-database/source = \"https:\/\/github.com\/nasa\/cumulus\/releases\/download\/$VERSION_FLAG\/terraform-aws-cumulus.zip\/\/lambdas\/db-provision-user-database/g" *.tf


  ## Prepare repo lambdas
  cd ..

  npm install
  npm run package-deployment
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

  # Extract cache of compiled TS files
  ./bamboo/extract-ts-build-cache.sh

  npm install
  npm run ci:bootstrap-no-scripts
  exit 0
fi

. ./bamboo/deploy-integration-stack.sh
