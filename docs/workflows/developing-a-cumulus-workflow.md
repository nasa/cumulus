---
id: developing-a-cumulus-workflow
title: Developing A Cumulus Workflow
hide_title: true
---

# Creating a Cumulus workflow

## The Cumulus workflow module

To facilitate adding a workflows to your deployment Cumulus provides a [workflow module](https://github.com/nasa/cumulus/tree/master/tf-modules/workflow).

In combination with the [Cumulus message](cumulus-task-message-flow), the workflow module provides a way to easily turn a Step Function definition into a Cumulus workflow, complete with:

- [AWS CloudWatch events](https://docs.aws.amazon.com/cloudwatch/index.html) that handle database updates for Cumulus objects (e.g. `executions`, `granules`, etc)
- Built-in integration with our [throttling](../data-cookbooks/throttling-queued-executions) feature

Using the module also ensures that your workflows will continue to be compatible with future versions of Cumulus.

For more on the full set of current available options for the module, please consult the module [README](https://github.com/nasa/cumulus/blob/master/tf-modules/workflow/README.md).

## Adding a new Cumulus workflow to your deployment

To add a new Cumulus workflow to your deployment that is using the `cumulus` module, add a new workflow resource to your deployment directory, either in a new `.tf` file, or to an existing file.

The workflow should follow a syntax similar to:

```hcl
module "my_workflow" {
  source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform-aws-cumulus-workflow.zip"

  prefix = "my-prefix"
  name   = "MyWorkflowName"
  system_bucket = "my-internal-bucket"

  workflow_config = module.cumulus.workflow_config

  tags = { Deployment = var.prefix }

  state_machine_definition = <<JSON
{}
JSON
}
```

In the above example, you would add your `state_machine_definition` using the [Amazon States Language](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-states-language.html), using [tasks you've developed](developing-workflow-tasks) and [Cumulus core tasks](../tasks) that are made available as part of the `cumulus` terraform module.

**Please note**: Cumulus follows the convention of tagging resources with the `prefix` variable `{ Deployment = var.prefix }` that you pass to the `cumulus` module.   For resources defined outside of Core, it's recommended that you adopt this convention as it makes resources and/or deployment recovery scenarios much easier to manage.

## Examples

For a functional example of a basic workflow, please take a look at the [hello_world_workflow](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/hello_world_workflow.tf).

For more complete/advanced examples, please read the following cookbook entries/topics:

- [HelloWorld workflow](../data-cookbooks/hello-world)
- [SIPS workflow](../data-cookbooks/sips-workflow)
- [CNM workflow](../data-cookbooks/cnm-workflow)
