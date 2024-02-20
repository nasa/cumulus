#!/bin/bash
set -ex

. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh
. ./bamboo/abort-if-skip-unit-tests.sh

docker ps -a ## Show running containers for output logs

docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run db:local:reset"
docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run test"
docker cp ${container_id}-build_env-1:${UNIT_TEST_BUILD_DIR}/testoutput.txt /tmp/testoutput.txt
# docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run coverage -- --noRerun"