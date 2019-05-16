#!/bin/bash
set -e
source .bamboo_env_vars || true
if [[ $GIT_PR != true && BRANCH != master ]]; then
  echo "******Branch HEAD is not a github PR, and this isn't a redeployment build, skipping step"
  exit 0
fi

container_id=${bamboo_planKey,,}
container_id=${container_id/-/}

docker ps -a
docker-compose -p ${container_id} down
docker-compose -p ${container_id} rm -f