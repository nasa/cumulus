#!/bin/bash
set -e
. ./bamboo/set-integration-test-env-variables.sh
(cd example && npm test)