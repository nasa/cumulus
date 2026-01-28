#!/bin/bash
CONFIG=$(jq -r '.' build-config.json)
RUNTIME=$(echo $CONFIG | jq -r '.runtime')
PYTHON_VERSION=$(echo $RUNTIME | sed 's/^python//')
ARCHITECTURE=$(echo $CONFIG | jq -r '.architecture')
UV_VERSION=$(echo $CONFIG | jq -r '.uv_version')

docker build \
    --platform linux/${ARCHITECTURE} \
    --build-arg UV_TAG=${UV_VERSION} \
    --build-arg LAMBDA_TAG=${PYTHON_VERSION}-${ARCHITECTURE} \
    --build-arg OUTPUT_FILENAME=lambda.zip \
    --output type=local,dest=dist/ \
    --file bin/Dockerfile.package .
