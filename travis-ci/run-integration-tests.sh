#!/bin/sh

set -ex

export AWS_ACCESS_KEY_ID="$INTEGRATION_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$INTEGRATION_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$INTEGRATION_AWS_DEFAULT_REGION"

set +e
(
  cd example
  if [ "$USE_NPM_PACKAGES" = "true" ]; then
    yarn
  else
    (cd .. && ./bin/prepare)
  fi

  yarn test
)
RESULT="$?"
set -e

exit "$RESULT"
