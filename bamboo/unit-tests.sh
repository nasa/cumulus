#!/bin/bash
set -ex

. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh
. ./bamboo/abort-if-skip-unit-tests.sh

docker ps -a ## Show running containers for output logs

docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run db:local:reset"
docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run test:coverage"
if [ -n "$(ls -A your/dir 2>/dev/null)" ]
then 
docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && aws s3 sync unit-logs s3://test-error-outputs/$(git rev-parse --abbrev-ref HEAD)/$(date +%DT%H.%M.%S)/"
fi
docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run coverage -- --noRerun"