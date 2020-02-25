#!/bin/bash
set -ex
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh
docker ps -a ## Show running containers for output logs

# Run unit tests (excluding integration/api tests)
docker exec -i ${container_id}\_build_env_1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR; nyc ./node_modules/.bin/lerna run test --ignore @cumulus/api --ignore cumulus-integration-tests"
# Run api tests
docker exec -i ${container_id}\_build_env_1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR/packages/api; npm run test-coverage"
# Report combined code coverage
docker exec -i ${container_id}\_build_env_1 /bin/bash -c "cd /source; mkdir .nyc_output; cp -a $UNIT_TEST_BUILD_DIR/.nyc_output/. /source/.nyc_output/; cp -a $UNIT_TEST_BUILD_DIR/packages/api/.nyc_output/. /source/.nyc_output/; nyc report;"
