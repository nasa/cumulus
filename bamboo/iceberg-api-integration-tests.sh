#!/bin/bash
set -ex

ENV_FILE=packages/api/app/.env.local
IMAGE_NAME=cumulus-iceberg-api:latest

if [[ ! -f $ENV_FILE ]]; then
  echo "*** Missing $ENV_FILE"
  echo "*** Create it from packages/api/app/env.local.example before running this script"
  exit 1
fi

echo "*** Building cumulus-iceberg-api docker image"
docker build --platform linux/arm64 -f packages/api/app/Dockerfile -t "$IMAGE_NAME" .

echo "*** Running Iceberg API local docker integration test (AVA)"
npm run test:docker:iceberg --workspace @cumulus/api
