#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

(
  cd example
  if [ "$USE_NPM_PACKAGES" = "true" ]; then
    yarn
  else
    (cd .. && ./bin/prepare)
  fi

  yarn test
)
