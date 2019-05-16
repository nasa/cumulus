#!/bin/bash
set -e
. ./abort-if-not-pr-or-redeployment.sh
. ./bamboo/set-bamboo-env-variables.sh
(cd example && npm test)