#!/bin/sh

(
  set -e
  cd packages/api
  npm run test-coverage
)
