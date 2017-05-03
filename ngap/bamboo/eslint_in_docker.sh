#!/bin/sh

set -e

(
  set -e
  cd /source
  ./node_modules/.bin/eslint \
    --ext .js\
    --format junit \
    --output-file results.xml \
    ./app/ ./test/
)
chown -R "${RELEASE_UID}:${RELEASE_GID}" /source/results.xml
