#!/bin/bash
export DOCKER_TAG=hello_world
export AWS_ACCOUNT_ID=$(cat ../app/.env | grep AWS_ACCOUNT_ID | cut -d'=' -f 2) 
export AWS_REGION=$(aws configure get region)

$(aws ecr get-login --no-include-email --region $AWS_REGION)

docker build -t ${DOCKER_TAG} -f Dockerfile.hello_world .
docker tag ${DOCKER_TAG}:latest ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${DOCKER_TAG}:latest
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${DOCKER_TAG}:latest
