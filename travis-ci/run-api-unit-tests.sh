#!/bin/sh

set -e

(
  cd packages/api
  ./node_modules/.bin/nyc ./node_modules/.bin/ava --serial
)
