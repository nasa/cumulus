# Cumulus - ECS service module

**Note:** To prevent a race condition during service deletion, make sure to set
depends_on to the related aws_iam_role_policy; otherwise, the policy may be
destroyed too soon and the ECS service will then get stuck in the DRAINING
state.

## Included resources

Provides an ECS service and task definition, including autoscaling configuration and Cloudwatch alarms for monitoring.

## Input variables

See [variables.tf](./variables.tf) for the input variables to this module and the default values for optional variables.
