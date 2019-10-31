---
id: run-tasks-in-lambda-or-docker
title: Run Step Function Tasks in Lambda or Docker
hide_title: true
---

# Running Step Function Tasks in AWS Lambda or Docker

## Overview

[AWS Step Function Tasks](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-tasks.html) can run tasks on [AWS Lambda](https://aws.amazon.com/lambda/) or on [AWS Elastic Container Service (ECS)](https://aws.amazon.com/ecs/) as a Docker container.

Lambda provides serverless architecture, providing the best option for minimizing cost and server management. ECS provides the fullest extent of AWS EC2 resources via the flexibility to execute arbitrary code on any AWS EC2 instance type.

## When to use Lambda

You should use AWS Lambda whenever all of the following are true:

* The task runs on one of the supported [Lambda Runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html). At time of this writing, supported runtimes include versions of python, Java, Ruby, node.js, Go and .NET.
* The lambda package is less than 50 MB in size, zipped.
* The task consumes less than each of the following resources:
  * 3008 MB memory allocation
  * 512 MB disk storage (must be written to `/tmp`)
  * 15 minutes of execution time

See [this page](https://docs.aws.amazon.com/lambda/latest/dg/limits.html) for a complete and up-to-date list of AWS Lambda limits.

If your task requires more than any of these resources or an unsupported runtime, creating a Docker image which can be run on ECS is the way to go. Cumulus supports running any lambda package (and its configured layers) as a Docker container with [`cumulus-ecs-task`](https://github.com/nasa/cumulus-ecs-task).

## Step Function Activities and `cumulus-ecs-task`

[Step Function Activities](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html) enable a state machine task to "publish" an activity task which can be picked up by any activity worker. Activity workers can run pretty much anywhere, but Cumulus workflows support the [`cumulus-ecs-task`](https://github.com/nasa/cumulus-ecs-task) activity worker. The `cumulus-ecs-task` worker runs as a Docker container on the Cumulus ECS cluster.

The `cumulus-ecs-task` container takes an AWS Lambda Amazon Resource Name (ARN) as an argument (see `--lambdaArn` in the example below). This ARN argument is defined at deployment time. The `cumulus-ecs-task` worker polls for new Step Function Activity Tasks. When a Step Function executes, the worker (container) picks up the activity task and runs the code contained in the lambda package defined on deployment.

## Example: Replacing AWS Lambda with a Docker container run on ECS

Whether using AWS Lambda or Step Functions Activities, there will be a lambda resource defined in a module or a top-level terraform file.

[Example](https://github.com/nasa/cumulus/blob/terraform/tf-modules/ingest/queue-granules-task.tf)

Given the `QueueGranules` lambda package is already used in a Step Function State Machine definition in a `cumulus` terraform module submodule the following will exist in a workflow JSON definition:

```json
  "QueueGranules": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "FullMessage": true
          },
          "task_config": {
            "provider": "{$.meta.provider}",
            "internalBucket": "{$.meta.buckets.internal.name}",
            "stackName": "{$.meta.stack}",
            "granuleIngestWorkflow": "${module.ingest_granule_workflow.name}",
            "queueUrl": "{$.meta.queues.startSF}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${module.cumulus.queue_granules_task_lambda_function_arn}",
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 6,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": "$.exception",
          "Next": "WorkflowFailed"
        }
      ],
      "Next": "CheckStatus"
    },
```

Given it has been discovered this task can no longer run in AWS Lambda, it can be run on the Cumulus ECS cluster by adding the following to your terraform deployment (these examples are taken from the [example 'ecs hello world workflow'](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/ecs_hello_world_workflow.tf)):

* A `aws_sfn_activity` resource:

```hcl
resource "aws_sfn_activity" "ecs_task_hello_world" {
  name = "${var.prefix}-EcsTaskHelloWorld"
  tags = local.default_tags
}
```


* A instance of the `cumulus_ecs_service` module (found on the Cumulus [release](https://github.com/nasa/cumulus/releases page):

```hcl

module "hello_world_service" {
  source = "https://github.com/nasa/cumulus/releases/download/{version}/terraform-aws-cumulus-ecs-service.zip"

  prefix = var.prefix
  name   = "HelloWorld"
  tags   = local.default_tags

  cluster_arn                           = module.cumulus.ecs_cluster_arn
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.3.0"
  log2elasticsearch_lambda_function_arn = module.cumulus.log2elasticsearch_lambda_function_arn

  cpu                = 400
  memory_reservation = 700

  environment = {
    AWS_DEFAULT_REGION = data.aws_region.current.name
  }
  command = [
    "cumulus-ecs-task",
    "--activityArn",
    aws_sfn_activity.ecs_task_hello_world.id,
    "--lambdaArn",
    module.cumulus.hello_world_task_lambda_function_arn
  ]
  alarms = {
    TaskCountHight = {
      comparison_operator = "GreaterThanThreshold"
      evaluation_periods  = 1
      metric_name         = "MemoryUtilization"
      statistic           = "SampleCount"
      threshold           = 1
    }
  }
}
```

* An updated workflow to utilize the new resource:

```hcl
 "EcsTaskHelloWorld": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "task_config": {
            "buckets": "{$.meta.buckets}",
            "provider": "{$.meta.provider}",
            "collection": "{$.meta.collection}"
          }
        }
      },
      "Type": "Task",
      "Resource": "${aws_sfn_activity.ecs_task_hello_world.id}",
      "TimeoutSeconds": 60,
      "Retry": [
        {
          "ErrorEquals": [
            "States.Timeout"
          ],
          "MaxAttempts": 1
        }
      ],
      "End": true
    }
```

## How do I name my resources? A short primer on Cumulus resource naming conventions

When deploying AWS Lambdas and AWS Activities as detailed above, note the following naming conventions:

* `aws_sfn_actifiy.name` and `aws_lambda+function.function_name` should  both be: ```${var.prefix}-FunctionName``` as this allows resources to be identified/associate with a particular deployment prefix, and is consistent with Cumulus provided lambdas.

## Final Note

Step Function Activities and AWS Lambda are not the only ways to run tasks in an AWS Step Function. Learn more about other service integrations, including direct ECS integration via the [AWS Service Integrations](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-connectors.html) page.
