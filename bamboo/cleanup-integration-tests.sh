#!/bin/bash
set -e
source .bamboo_env_vars || true
if [[ $GIT_PR != true && $RUN_REDEPLOYMENT != true ]]; then
  >&2 echo "******Branch HEAD is not a github PR, and this isn't a redeployment build, skipping step"
  exit 0
fi

npm install
. ./bamboo/set-bamboo-env-variables.sh
set +e
(
  set -e

  cd example

  # Delete the stack if it's a nightly build
  if [ "$DEPLOYMENT" = "cumulus-nightly" ]; then
    npm install
    echo Delete app deployment

    ./node_modules/.bin/kes cf delete \
      --kes-folder app \
      --region us-east-1 \
      --deployment "$DEPLOYMENT" \
      --yes

    echo Delete iam deployment

    ./node_modules/.bin/kes cf delete \
      --kes-folder iam \
      --region us-east-1 \
      --deployment "$DEPLOYMENT" \
      --yes

    echo Delete app deployment
  else
    rm -rf node_modules

    # Needed functionality is in 1.11.3
    # Prevents breaking on a release build when it tries to install
    # the version that does not exist
    # We only need the common package for the lock-stack script
    npm install @cumulus/common@1.11.3
  fi
)
RESULT=$?
set -e

echo Unlocking stack
(cd example && node ./scripts/lock-stack.js false $DEPLOYMENT)

exit $RESULT
