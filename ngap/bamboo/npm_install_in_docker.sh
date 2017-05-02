#!/bin/sh

set -e

(set -e && cd /source && npm install)
chown -R "${RELEASE_UID}:${RELEASE_GID}" /source/node_modules
