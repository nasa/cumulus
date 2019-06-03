#!/bin/bash
set -e
. ./bamboo/abort-if-not-pr-or-master.sh

npm install
npm run bootstrap-no-build
npm run lint
