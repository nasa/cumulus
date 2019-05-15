#!/bin/bash
# This script runs before lint.sh, audit.sh in the agent container
npm install -g npm
ln -s /dev/stdout ./lerna-debug.log
