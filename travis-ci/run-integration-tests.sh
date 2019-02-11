#!/bin/sh

set -e

sh set-env-vars.sh

(
  cd example
  if [ "$USE_NPM_PACKAGES" = "true" ]; then
    yarn
  else
    (cd .. && ./bin/prepare)
  fi

  yarn test
)
