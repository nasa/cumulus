#!/bin/bash
ln -s /dev/stdout ./lerna-debug.log
npm install -g npm # install latest npm version
npm install --no-audit
npm run install-locks
npm run audit