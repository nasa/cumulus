#!/bin/bash
set -e
docker ps -a ## Show running containers for output logs

# Run unit tests, excluding integration/api tests
docker exec -i $bamboo_planKey_build_env_1 /bin/bash -c 'cd /source/cumulus; nyc ./node_modules/.bin/lerna run test --ignore @cumulus/api --ignore cumulus-integration-tests'
# Run api tests
docker exec -i $bamboo_planKey_env_1 /bin/bash -c 'cd /source/cumulus/packages/api; npm run test-coverage'