# Docker files for creating images to be used in ECS Task Definitions

## `hello_world`

`hello_world` is a simple docker image currently used for testing the `FargateHelloWorld` workflow.

Below are instructions for how to build and push this docker image to AWS ECR.

If the repository does not yet exist, run:

```bash
export DOCKER_TAG=hello_world

$(aws ecr get-login --no-include-email --region us-east-1)
aws ecr create-repository --repository-name ${DOCKER_TAG}
```

If the repository already exists, execute:

```bash
./build_dockers.sh
```

or from the root of the `example/` directory:

```bash
npm run build-dockers
```
