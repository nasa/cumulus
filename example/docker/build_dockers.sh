#!/bin/bash
export DOCKER_TAG=hello_world
export AWS_ACCOUNT_ID=$(cat ../app/.env | grep AWS_ACCOUNT_ID | cut -d'=' -f 2) 

$(aws ecr get-login --no-include-email --region us-east-1)

docker build -t ${DOCKER_TAG} -f Dockerfile.hello_world .
docker tag ${DOCKER_TAG}:latest ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/${DOCKER_TAG}:latest
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/${DOCKER_TAG}:latest
