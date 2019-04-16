#!/bin/bash
ln -s /dev/stdout ./lerna-debug.log
npm install --no-audit
npm run install-locks
npm run audit