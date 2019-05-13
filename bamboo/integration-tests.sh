#!/bin/bash
set -e
. ./bamboo/set-bamboo-env-variables.sh
(cd example && npm test)