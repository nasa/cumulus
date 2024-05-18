#!/bin/bash
set -ex

. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh
. ./bamboo/abort-if-skip-unit-tests.sh

docker ps -a ## Show running containers for output logs

docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run db:local:reset"
docker exec -i ${container_id}-build_env-1 \
  /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && \
  ./scripts/run_ci_unit_coverage.sh" \
echo "what follows should be an ls of the unit-logs/cumulus directory"
ls ./unit-logs/@cumulus/
if [ -n "$(ls -A ./unit-logs/@cumulus 2>/dev/null)" ]
then 
    aws s3 sync unit-logs/@cumulus/ s3://unit-test-error-logs/$(git rev-parse --abbrev-ref HEAD)/$(date +%Y-%m-%dT%H.%M.%S)/
fi