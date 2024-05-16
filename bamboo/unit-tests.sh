#!/bin/bash
set -ex

. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh
. ./bamboo/abort-if-skip-unit-tests.sh

docker ps -a ## Show running containers for output logs

docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run db:local:reset"
docker exec -i ${container_id}-build_env-1 \
  -e AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id)\
  -e AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key)\
  -e AWS_REGION=$(aws configure get region || echo $AWS_DEFAULT_REGION)\
  /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && ./scripts/run_ci_unit_coverage.sh"