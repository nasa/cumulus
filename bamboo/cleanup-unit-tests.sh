#!/bin/bash
set -e
container_id=${bamboo_planKey,,}
container_id=${container_id/-/)

docker ps -a
docker-compose -p ${container_id} down
docker-compose -p ${container_id} rm -f