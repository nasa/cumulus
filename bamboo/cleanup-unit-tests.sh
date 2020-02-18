#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr.sh

container_id=${bamboo_planKey,,}
container_id=${container_id/-/}

export COMPOSE_FILE=./bamboo/docker-compose.yml

docker ps -a
docker exec -it ${container_id}_ftp_1 cat /var/log/vsftpd.log || true
docker-compose -p ${container_id} down
docker-compose -p ${container_id} rm -f