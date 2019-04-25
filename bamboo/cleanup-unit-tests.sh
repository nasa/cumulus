#!/bin/bash
set -e
docker ps -a
docker-compose -p ${bamboo_planKey,,} down
docker-compose -p -${bamboo_planKey,,} rm -f