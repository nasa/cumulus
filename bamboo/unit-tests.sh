#!/bin/bash
set -e
. ./set-bamboo-env-variables.sh
if [[ $GIT_PR != true ]]; then
  echo "******Branch HEAD is not a github PR, and this isn't a redeployment build, skipping bootstrap/deploy step"
  exit 0
fi

docker ps -a ## Show running containers for output logs

# Run unit tests (excluding integration/api tests)
docker exec -i ${container_id}\_build_env_1 /bin/bash -c 'cd /source/cumulus; nyc ./node_modules/.bin/lerna run test --ignore @cumulus/api --ignore cumulus-integration-tests'
# Run api tests
docker exec -i ${container_id}\_build_env_1 /bin/bash -c 'cd /source/cumulus/packages/api; npm run test-coverage'
