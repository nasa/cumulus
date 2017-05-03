#!/bin/sh

set -e

(
  set -e
  cd /source
  ./node_modules/.bin/eslint \
    --ext .js\
    --format junit \
    --output-file test-results.xml \
    ./app/ ./test/
)
chown -R "${RELEASE_UID}:${RELEASE_GID}" /source/test-results.xml
