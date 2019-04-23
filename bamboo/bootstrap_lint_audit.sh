#!/bin/bash
# This script runs before lint.sh, audit.sh in the agent container
ln -s /dev/stdout ./lerna-debug.log