#!/bin/bash
# This script runs before lint.sh, audit.sh in the agent container
. ./abort-if-not-pr-or-master.sh

npm install -g npm
ln -s /dev/stdout ./lerna-debug.log
npm install --no-audit
