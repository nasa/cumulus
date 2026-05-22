#!/bin/bash

# This script builds the Docker image for the compactor and initialization scripts
set -e

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] [TAG]

Builds the Docker image for the compactor and initialization scripts.

Arguments:
  TAG                Docker image tag (default: latest)

Options:
  -h                 Show this help message and exit

Environment Variables:
  PLATFORM           (optional) Runtime platform for image - default is linux/amd64

Examples:
  $(basename "$0")              # Build with tag 'latest'
  $(basename "$0") 1.2.3        # Build with tag '1.2.3'
EOF
}

if [[ "$1" == "-h" ]]; then
    usage
    exit 0
fi

REQUIRED_VARS=(
)

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "❌ Error: The following environment variables are empty:"
    for missing in "${MISSING_VARS[@]}"; do
        echo "  - $missing"
    done
    exit 1
fi

image="cumulus/replication-bootstrap"
tag=${1:-latest}
platform=${PLATFORM:-linux/arm64}

echo "Building image for $platform"

docker build --platform="$platform" -t "$image:$tag" -f "./Dockerfile.bootstrap"  .
