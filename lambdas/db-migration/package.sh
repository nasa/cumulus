#!/bin/sh

set -e

export PATH="../../node_modules/.bin:${PATH}"

rm -rf dist

tsc

cp package.json dist/lambda

(
  cd dist/lambda

  npm install --production

  rm -f package.json package-lock.json

  zip -r ../lambda.zip migrations node_modules index.js
)
