#!/bin/sh

set -e

export PATH="../../node_modules/.bin:${PATH}"

rm -rf dist

tsc

cp package.json dist/lambda

(
  cd dist/lambda

  mkdir -p node_modules

  npx lerna link  
  
  npm install --production

  rm -f package.json package-lock.json

  zip -r ../lambda.zip node_modules index.js
)
