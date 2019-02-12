#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

cd example || exit 1
yarn

./travis-ci/cleanup-stack.sh