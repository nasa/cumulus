#!/bin/sh

###
# This script is intended to be run inside of docker.  It will install the
# node modules declared in packages.json.
#
# It should be invoked with:
#
# docker run \
#   -e RELEASE_UID=$(id -u) \
#   -e RELEASE_GID=$(id -g) \
#   --rm \
#   -v "$(pwd):/source" \
#   node \
#   /source/ngap/bamboo/npm_install_in_docker.sh
#
###

set -e

(set -e && cd /source && npm install)
chown -R "${RELEASE_UID}:${RELEASE_GID}" /source/node_modules
