#!/bin/bash
set -e

# This script runs before lint.sh, audit.sh in the agent container
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh
yum install wget || apt install wget

update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 && \
    update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1
if [[ $USE_CACHED_BOOTSTRAP == true ]]; then ## Change into cached cumulus, pull down /cumulus ref and run there
  echo "*** Using cached bootstrap"
  cp .bamboo_env_vars /cumulus/
  cd /cumulus/
fi

git fetch --all

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  git checkout "$GIT_SHA"
  rm -f package-lock.json
fi

npm install --ignore-scripts --no-package-lock
npm run install-python-deps
ln -s /dev/stdout ./lerna-debug.log
