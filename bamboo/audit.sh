#!/bin/bash
ln -s /dev/stdout ./lerna-debug.log
npm install --no-audit
npm run install-locks
# npm run audit # Disabling for dev due to ongoing audit issue.
