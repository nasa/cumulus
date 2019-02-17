# Docker files for creating images to be used in ECS Task Definitions

## `hello_world`

`hello_world` is a simple docker image currently used for testing the `FargateHelloWorld` workflow.

Below are instructions for how to build and push this docker image to AWS ECR.

1. Create the `hello_world` repository

```bash
export DOCKER_TAG=hello_world
export AWS_ACCOUNT_ID=$(cat ../app/.env | grep AWS_ACCOUNT_ID | cut -d'=' -f 2) 

$(aws ecr get-login --no-include-email --region us-east-1)
aws ecr create-repository --repository-name ${DOCKER_TAG}
```

2. Build and push

```bash
docker build -t ${DOCKER_TAG} -f Dockerfile.hello_world .
docker tag ${DOCKER_TAG}:latest ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/${DOCKER_TAG}:latest
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/${DOCKER_TAG}:latest
```
