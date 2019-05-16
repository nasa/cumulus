#!/bin/bash
set -e
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/set-bamboo-env-variables.sh
(cd example && npm test)