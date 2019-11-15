# Cumulus - ECS service module

**Note:** To prevent a race condition during service deletion, make sure to set
depends_on to the related aws_iam_role_policy; otherwise, the policy may be
destroyed too soon and the ECS service will then get stuck in the DRAINING
state.

## Included resources

Provides an ECS service and task definition, including autoscaling configuration and Cloudwatch alarms for monitoring.

## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.

## Outputs

- **service_name** - Name of the created ECS service

## Example

```hcl
module "example_ecs_service" {
  source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform-aws-cumulus-ecs-service.zip"

  prefix = "my-prefix"
  name   = "MyServiceName"

  log2elasticsearch_lambda_function_arn = "arn:aws:lambda:us-east-1:1234567890:function:log2elasticsearch"

  cluster_arn                           = "arn:aws:ecs:us-east-1:1234567890:cluster/MyECSCluster1"
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.3.0"
}
```
