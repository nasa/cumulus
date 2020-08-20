#!/bin/sh

set -e

export PATH="../../node_modules/.bin:${PATH}"

rm -rf dist

tsc

cp package.json dist

(
  cd dist/

  npm install --production

  rm -f package.json package-lock.json

  zip -r lambda.zip node_modules index.js -x '*@cumulus/api/dist*'
)
