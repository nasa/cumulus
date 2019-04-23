#!/bin/bash
# This script is intented to run following bootstrap_lint_audit.sh
npm install
npm run bootstrap-no-build
npm run lint
