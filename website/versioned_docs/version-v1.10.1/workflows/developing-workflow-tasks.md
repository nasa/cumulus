---
id: version-v1.10.1-developing-workflow-tasks
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

```
  ecs:
    instanceType: t2.small
    desiredInstances: 1
    availabilityZone: us-east-1a
    imageId: ami-a7a242da
    publicIp: true
    docker:
      username: cumulususer
    services:
      EcsTaskHelloWorld:
        image: cumuluss/cumulus-ecs-task:1.2.3
        cpu: 800
        memory: 1500
        count: 1
```
