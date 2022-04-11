# Cumulus - ECS service module

**Note:** To prevent a race condition during service deletion, make sure to set
depends_on to the related aws_iam_role_policy; otherwise, the policy may be
destroyed too soon and the ECS service will then get stuck in the DRAINING
state.

## Included resources

Provides an ECS service and task definition, including autoscaling configuration and Cloudwatch alarms for monitoring.

## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.

### Notable Input Variables

#### `use_fargate` - boolean option, if set to true, module will deploy the service as a fargate service.  Setting this option to true requires the following configuration options

* `cpu` and `memory_reservation` should be set to [legitimate  values](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html) for AWS Fargate.

* `execution_role_arn` - this value must be set to a role ARN that provides appropriate permissions to execute the ECS task.  For cumulus deployments using the Core-provided ECS cluster this is provided as output from the cumulus module as `ecs_execution_role_arn`

* `task_role_arn` - this value must be set to a role ARN that provides appropriate permissions for the executing task.  For cumulus deployments using the Core-provided ECS cluster this is provided as output from the cumulus module as `ecs_task_role_arn`

* `desired_count` - the desired number of concurrent running fargate instances for this service/task at deployment time.

## Outputs

- **service_name** - Name of the created ECS service

## Example

```hcl
module "example_ecs_service" {
  source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform-aws-cumulus-ecs-service.zip"

  prefix = "my-prefix"
  name   = "MyServiceName"

  cluster_arn                           = "arn:aws:ecs:us-east-1:1234567890:cluster/MyECSCluster1"
  desired_count                         = 1
  image                                 = "cumuluss/cumulus-ecs-task:1.7.0"
}
```
