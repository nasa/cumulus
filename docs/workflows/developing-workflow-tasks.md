---
id: developing-workflow-tasks
title: Developing Workflow Tasks
hide_title: true
---

# Developing Workflow Tasks

Workflow tasks can be either AWS Lambda Functions or ECS Activities.

## Lambda functions

The full set of available core Lambda functions can be found in the deployed `cumulus` module zipfile at `/tasks`, as well as reference documentation [here](tasks.md).  These Lambdas can be referenced in workflows via the outputs from that module (see the `cumulus-template-deploy` [repo](https://github.com/nasa/cumulus-template-deploy/tree/master/cumulus-tf) for an example).

The tasks source is located in the Cumulus repository at [cumulus/tasks](https://github.com/nasa/cumulus/tree/master/tasks).

You can also develop your own Lambda function. See the [Lambda Functions](workflows/lambda.md) page to learn more.

## ECS Activities

ECS activities are supported via the [`cumulus_ecs_module`](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus_ecs_service) available from the [Cumulus release page](https://github.com/nasa/cumulus/releases).

Please read the module [README](https://github.com/nasa/cumulus/blob/master/tf-modules/cumulus_ecs_service/README.md) for configuration details.

For assistance in creating a `task definition` within the module read the [AWS Task Definition Docs](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/create-task-definition.html).

For a step-by-step example of using the `cumulus_ecs_module`, please see the related [cookbook entry](../data-cookbooks/run-tasks-in-lambda-or-docker).

### Cumulus Docker Image

ECS activities require a docker image.  Cumulus provides a docker image ([source](https://github.com/nasa/cumulus-ecs-task) for node 8.10 lambdas on dockerhub: [cumuluss/cumulus-ecs-task](https://hub.docker.com/r/cumuluss/cumulus-ecs-task).

### Alternate Docker Images

Custom docker images/runtimes are supported as are private registries.  For details on configuring a private registry/image see the AWS documentation on [Private Registry Authentication for Tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/private-auth.html).
