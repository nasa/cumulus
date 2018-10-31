#!/bin/sh

set -e

(
  set -e
  cd packages/api
  npm run test-coverage
)
