#!/bin/bash
set -ex

. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh

if [[ "$DEPLOY_ICEBERG_API" != "true" ]]; then
  echo "Skipping deploy Iceberg API Image step (DEPLOY_ICEBERG_API=$DEPLOY_ICEBERG_API)" >&2
  exit 0
fi
echo "***Deploying Iceberg API image"

if ! command -v docker >/dev/null 2>&1; then
  apt-get update && apt-get install -y docker.io
fi

set_iceberg_image_version

image="cumulus-iceberg-api"
registry_host="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${registry_host}"
# Create ECR repo if it doesn't exist
if ! aws ecr describe-repositories --repository-names "${image}" >/dev/null 2>&1; then
  if aws ecr describe-repositories --repository-names "${image}" 2>&1 | grep -q RepositoryNotFoundException; then
    aws ecr create-repository --repository-name "${image}" >/dev/null
  else
    echo "Error: unable to verify ECR repository ${image}." >&2
    exit 1
  fi
fi

IMAGE_NAME="${registry_host}/${image}:${ICEBERG_IMAGE_VERSION}"

echo "Building Iceberg API image with name=${IMAGE_NAME}"
docker build --platform linux/arm64 -f packages/api/app/Dockerfile -t "$IMAGE_NAME" .

echo "Publishing Docker image to ECR with name=${IMAGE_NAME}"
docker push "$IMAGE_NAME"
