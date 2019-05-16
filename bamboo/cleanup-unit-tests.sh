#!/bin/bash
set -e
. ./abort-if-not-pr-or-master.sh

container_id=${bamboo_planKey,,}
container_id=${container_id/-/}

docker ps -a
docker-compose -p ${container_id} down
docker-compose -p ${container_id} rm -f