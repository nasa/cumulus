#!/bin/sh

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
