#!/bin/bash

set -ex

image="connect"
original_repo="quay.io/debezium"
ecr_repo="cumulus/debezium"
tag=${1:-3.4}

region=${AWS_DEFAULT_REGION-"us-east-1"}

# pull the original image
docker pull "$original_repo/$image:$tag"

source ./scripts/push_to_ecr.sh
push_to_ecr "${image}" "${tag}"
