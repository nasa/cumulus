#!/bin/bash
set -ex
error_to_s3 () {
  ngap_env=$(echo $NGAP_ENV | awk '{print tolower($0)}')
  bucket_name=${ngap_env}-unit-test-error-logs
  aws s3api create-bucket --bucket $bucket_name 2>/dev/null | echo "bucket ${bucket_name} could not be created"
  if [ -n "$(ls -A $CUMULUS_UNIT_TEST_DATA/unit-logs/@cumulus 2>/dev/null)" ]
  then
      aws s3 sync $CUMULUS_UNIT_TEST_DATA/unit-logs/@cumulus/ s3://${ngap_env}-unit-test-error-logs/$(git rev-parse --abbrev-ref HEAD)/$(date +%Y-%m-%dT%H.%M.%S)/;
      
      docker exec -i ${container_id}-build_env-1 /bin/bash -c "rm -rf $CUMULUS_UNIT_TEST_DATA/unit-logs/"
  fi

  exit 1;
}
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh
. ./bamboo/abort-if-skip-unit-tests.sh

docker ps -a ## Show running containers for output logs

docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run db:local:reset"
docker exec -i ${container_id}-build_env-1 \
  /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && \
  ./scripts/run_ci_unit_coverage.sh" || error_to_s3 

docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && npm run coverage -- --merge --noRerun"
docker exec -i ${container_id}-build_env-1 /bin/bash -c "cd $UNIT_TEST_BUILD_DIR && nyc report"