#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr.sh

npm install
npm run bootstrap-no-build
npm run lint-md
npm run lint
