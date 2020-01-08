#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr.sh

npm install
npm run lint-md
npm run lint
