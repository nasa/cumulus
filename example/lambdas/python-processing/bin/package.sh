#!/bin/bash

DIR=$1

# Find source location
echo "Entering $DIR..."
cd "$DIR" || exit 1

# Build Docker image
echo "Building Docker image..."
docker build --platform linux/amd64,linux/arm64 \
    -t cumulus-test-ingest-process:{VERSION} \
    .
