#!/bin/sh

set -e

npm run tsc

rm -rf dist/webpack

npm run webpack

cp -R schemas dist/webpack

(
  set -e

  cd dist/webpack
  rm -f lambda.zip && node ../../../../bin/zip.js lambda.zip index.js schemas
)
