#!/bin/sh

set -e

rm -rf webpack

npm run webpack

cp -R schemas webpack

(
  set -e

  cd webpack
  rm -f lambda.zip && node ../../../bin/zip.js lambda.zip index.js schemas
)
