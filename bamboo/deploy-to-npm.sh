#!/bin/bash
set -ex
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh

pip install pipenv
npm run bootstrap
./node_modules/.bin/lerna run prepublish

