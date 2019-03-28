---
id: run-tasks-in-lambda-or-docker
title: Run Step Function Tasks in Lambda or Docker
hide_title: true
---

# Running Step Function Tasks in AWS Lambda or Docker

## Overview

[AWS Step Function Tasks](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-tasks.html) can run tasks on [AWS Lambda](https://aws.amazon.com/lambda/) functions or [AWS Elastic Container Service (ECS)](https://aws.amazon.com/ecs/) as a Docker container.

Lambda provides serverless architecture, providing the best option for cost and server management. ECS provides the flexibility to execute any code on any AWS EC2 instance type your task might require. 

## When to use Lambda

You should use AWS Lambda whenever all of the following are true:

* The task runs on one of the supported [Lambda Runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html). At time of this writing, supported runtimes include select versions of python, Java, Ruby, node.js, Go and .NET.
* The lambda package is less than 50 MB in size, zipped.
* The task consumes less the following resources:
    * 3008 MB memory allocation
    * 512 MB disk storage (must be written to `/tmp`)
    * 15 minutes of execution time

See [this page](https://docs.aws.amazon.com/lambda/latest/dg/limits.html) for a complete and up-to-date list of AWS Lambda limits.

If your task requires more than any of these resource limitations or an unsupported runtime, creating a Docker image which can be run on ECS is the way to go. Cumulus supports running any lambda package as a Docker container using Step Function Activities and `cumulus-ecs-task`.

## Step Function Activities and `cumulus-ecs-task`

[Step Function Activities](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html) enable a state machine task to "publish" an activity task which can be picked up by any activity worker. Activity workers can run pretty much anywhere, but Cumulus workflows support [`cumulus-ecs-task`](https://github.com/nasa/cumulus-ecs-task) activity workers. The `cumulus-ecs-task` worker runs as a Docker container on the Cumulus ECS cluster.

The `cumulus-ecs-task` container takes an AWS Lambda Amazon Resource Name (ARN) as an argument (see `--lambdaArn` in the example below). This ARN argument is defined at deployment time. The `cumulus-ecs-task` container polls for new Step Function Activity Tasks. When a Step Function executes, the worker (container) picks up the task and runs the code contained in the lambda package defined on deployment.

## Example: Replacing AWS Lambda with a Docker container run on ECS

Whether using AWS Lambda or Step Functions Activities, there will be a lambda package defined in `lambdas.yml`:

```yaml
QueueGranules:
  handler: index.handler
  timeout: 900
  memory: 3008
  source: node_modules/@cumulus/queue-granules/dist/
  useMessageAdapter: true
```

Given the `QueueGranules` lambda package is already used Step Function State Machine definition, the following will exist in a workflows yaml file:

```yaml
    QueueGranules:
      Type: Task
      Resource: ${QueueGranulesLambdaFunction.Arn}
      Next: StopStatus
```

Given it has been discovered this task can no longer run in AWS Lambda because it uses more than 3008MB of memory, it can be run on the Cumulus ECS cluster by including the following in `app/config.yml`:

```yaml
  ecs:
    instanceType: t2.large
    desiredInstances: 1
    services:
      QueueGranules:
        docker: true
        image: cumuluss/cumulus-ecs-task:1.2.5
        memory: 4000
        count: 1
        envs:
          AWS_DEFAULT_REGION:
            function: Fn::Sub
            value: '${AWS::Region}'
        commands:
          - cumulus-ecs-task
          - '--activityArn'
          - function: Ref
            value: QueueGranulesActivity
          - '--lambdaArn'
          - function: Ref
            value: QueueGranulesLambdaFunction

  activities:
    - name: QueueGranules
```

and then modifying the corresponding Step Function State Machine definition:

```yaml
    QueueGranules:
      Type: Task
      Resource: ${QueueGranulesActivity}
      Next: StopStatus
```

## Final Note

Step Function Activities and AWS Lambda are not the only ways to run tasks in an AWS Step Function. Learn more about other service integrations, including direct ECS integration via the [AWS Service Integrations](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-connectors.html) page.

