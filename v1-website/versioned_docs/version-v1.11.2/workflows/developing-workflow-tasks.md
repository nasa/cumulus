---
id: version-v1.11.2-developing-workflow-tasks
title: Developing Workflow Tasks
hide_title: true
original_id: developing-workflow-tasks
---

# Developing Workflow Tasks
Workflow tasks can be either AWS Lambda Functions or ECS Activities.

## Lambda functions

You can use one of the many `@cumulus` node modules to take advantage of common functionality for Cumulus workflows, such as `@cumulus/parse-pdr` and `@cumulus/post-to-cmr`.

The full set of available lambda functions can be found on npm: [npmjs.com/org/cumulus](https://www.npmjs.com/org/cumulus) and in source code: [cumulus/tasks](https://github.com/nasa/cumulus/tree/master/tasks).

You can also develop your own lambda function, read more on the [Lambda Functions](workflows/lambda.md) page.

## ECS Activities

ECS activities require a docker image. The docker image is defined as part of the ECS cluster definition in your deployments `config.yml`, e.g.:

```yaml
  ecs:
    instanceType: t2.small
    desiredInstances: 1
    availabilityZone: us-east-1a
    imageId: ami-a7a242da
    publicIp: true
    docker:
      username: cumulususer
      registry: dockerhub
    services:
      EcsTaskHelloWorld:
        image: cumuluss/cumulus-ecs-task:1.2.3
        cpu: 800
        memory: 1500
        count: 1
```

*Note:* If there is no custom configuration required for docker (`username`, `registry`, etc.), then it is recommended to either omit the `docker` line or comment it out.

### Specifying a Docker Registry (ECR | Dockerhub)

Cumulus currently supports two methods of pulling images from a hosted repository by setting the `ecs.docker.registry` attribute to either `ecr` or `dockerhub`. `dockerhub` is the default value:

*ecr* will use the IAM role attached to the instance (defined in `packages/deployment/iam/cloudformation.template.yml` under `ECSRole`) to authenticate against a repository hosted in [AWS ECR](https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html). It is important to note that using this method will still allow instances to pull images from *public* dockerhub repositories *without authentication.*

```yaml
  ecs:
    ...
    docker:
      registry: ecr
    ...
```

*dockerhub* will use `ecs.docker.username` specified in `app/config.yml` and the `DOCKER_PASS` and `DOCKER_EMAIL` environment varaibles (if they exist or from `app/.env`) to authenticate against the public `dockerhub` endpoint.

```yaml
  ecs:
    ...
    docker:
      registry: dockerhub
    ...
```
*Note:* Since `dockerhub` is the default `registry`, the docker configuration immediately above is equivalent to omitting the `docker` tag.

More on `dockerhub` authentication can be found in [aws documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/private-auth-container-instances.html) under `docker` Authentication Format.
