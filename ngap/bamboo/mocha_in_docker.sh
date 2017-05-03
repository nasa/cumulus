#!/bin/sh

### 
# This script is intended to be run inside of docker.  It will run the mocha
# tests and write results out to test-results.xml.
#
# It should be invoked with:
#
# docker run \
#   -e RELEASE_UID=$(id -u) \
#   -e RELEASE_GID=$(id -g) \
#   --rm \
#   -v "$(pwd):/source" \
#   node \
#   /source/ngap/bamboo/mocha_in_docker.sh
#
###

set -e

(
  set -e
  cd /source
  ./node_modules/.bin/mocha-webpack \
    --reporter mocha-junit-reporter \
    --reporter-options mochaFile=test-results.xml  \
    --require babel-polyfill \
    --webpack-config webpack.config-test.js \
    test/**/*spec.js
)
chown -R "${RELEASE_UID}:${RELEASE_GID}" /source/test-results.xml
