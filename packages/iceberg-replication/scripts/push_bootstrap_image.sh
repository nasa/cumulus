#!/bin/bash

set -ex

image="cumulus/replication-bootstrap"
tag=${1:-latest}

source ./scripts/push_to_ecr.sh
push_to_ecr "${image}" "${tag}"
