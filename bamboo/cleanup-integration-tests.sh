#!/bin/bash
# shellcheck disable=SC1091

set -ex
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh

echo Unlocking stack
echo "*** Using cached bootstrap"
cp .bamboo_env_vars /cumulus/
cd /cumulus/
git fetch --all
git checkout "$GIT_SHA"

cd /cumulus/example && node ./scripts/lock-stack.js lock "$GIT_SHA" "$DEPLOYMENT" false