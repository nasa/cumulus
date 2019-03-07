#!/bin/sh

set -evx

./travis-ci/install-aws-cli.sh

MD5SUM=$(cat $(git ls-files | grep package-lock.json | sort) | md5sum | awk '{print $1}')
CACHE_FILENAME="${MD5SUM}.tar.gz"
KEY="travis-ci-cache/${CACHE_FILENAME}"

~/bin/aws s3 ls "s3://${CACHE_BUCKET}/${KEY}" >/dev/null
CACHE_EXISTS_STATUS_CODE="$?"

if [ "$CACHE_EXISTS_STATUS_CODE" -eq "0" ]; then
  echo "Cache already exists: s3://${CACHE_BUCKET}/${KEY}"
else
  echo "Creating cache"
  npm ci
  # npm run bootstrap-no-build
  # ./node_modules/.bin/lerna --loglevel silly --no-progress bootstrap --ignore-scripts -- --loglevel silly
  ./node_modules/.bin/lerna --no-progress bootstrap --ignore-scripts

  for p in $(git ls-files | grep package.json); do
    NODE_MODULES_DIR="$(dirname $p)/node_modules"
    if [ -d "$NODE_MODULES_DIR" ]; then
      tar -rf "${MD5SUM}.tar" "$(dirname $p)/node_modules"
    fi
  done

  gzip "${MD5SUM}.tar"

  CACHE_SIZE=$(du -sh "$CACHE_FILENAME" | awk '{ print $1 }')
  echo "Cache size: $CACHE_SIZE"

  echo "Uploading cache to s3://${CACHE_BUCKET}/${KEY}"

~/bin/aws s3 cp "$CACHE_FILENAME" "s3://${CACHE_BUCKET}/${KEY}"
fi
