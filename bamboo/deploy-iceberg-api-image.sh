#!/bin/bash
set -ex
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh

if [[ "$DEPLOY_ICEBERG_API" != "true" ]]; then
  echo "Skipping deploy Iceberg API Image step (DEPLOY_ICEBERG_API=$DEPLOY_ICEBERG_API)" >&2
  exit 0
fi

if [[ -z $ICEBERG_IMAGE_VERSION ]]; then
  echo "Error: ICEBERG_IMAGE_VERSION is not set." >&2
  exit 1
fi

apt-get update && apt-get install -y docker.io

image="cumulus-iceberg-api"
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin "https://${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
# Create ECR repo if it doesn't exist
aws ecr describe-repositories --repository-names ${image} || aws ecr create-repository --repository-name ${image}

IMAGE_NAME=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$image:$ICEBERG_IMAGE_VERSION

echo "Building Iceberg API image with name=${IMAGE_NAME}"
docker build --platform linux/arm64 -f packages/api/app/Dockerfile -t "$IMAGE_NAME" .

echo "Publishing Docker image to ECR with name=${IMAGE_NAME}"
docker push "$IMAGE_NAME"
