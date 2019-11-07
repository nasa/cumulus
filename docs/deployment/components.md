---
id: components
title: Cumulus Components
hide_title: true
---

# Component-based Cumulus Deployment

Cumulus is now released in a modular architecture, which will allow users to
pick and choose the individual components that they want to deploy. These
components will be made available as [Terraform modules](https://www.terraform.io/docs/modules/index.html).

Cumulus users will be able to add those individual components to their
deployment and link them together using Terraform. In addition, users will be
able to make use of the large number of publicly available modules on the [Terraform Module Registry](https://registry.terraform.io/).

## Available Cumulus Components

* [Cumulus](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus)
* [Data persistence](https://github.com/nasa/cumulus/tree/master/tf-modules/data-persistence)
* [ECS service](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus-ecs-service)
* [Distribution](https://github.com/nasa/cumulus/tree/master/tf-modules/distribution)
* [Thin Egress App](./thin_egress_app)
* [Workflow](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus-ecs-service)

## Adding components to your Terraform deployment

Although Terraform components can be configured using a single file, it is recommended to
add the following files to your deployment:

* **variables.tf** - [input variables](https://www.terraform.io/docs/configuration/variables.html)
  used in your Terraform configuration
* **main.tf** - the contents of your deployment, mostly made up of
  [module](https://www.terraform.io/docs/configuration/modules.html#calling-a-child-module)
  statements and a
  [provider configuration block](https://www.terraform.io/docs/configuration/providers.html#provider-configuration).
* **outputs.tf** - any [output values](https://www.terraform.io/docs/configuration/outputs.html)
  to be returned by your deployment
* **terraform.tf** - contains [remote state](#remote-state) configuration, and
  any other configuration of Terraform itself
* **terraform.tfvars** -
  [variable definitions](https://www.terraform.io/docs/configuration/variables.html#variable-definitions-tfvars-files)

**variables.tf**, **main.tf**, and **outputs.tf** should be stored in version
control, as they will be constant no matter what environment you are deploying
to.

**terraform.tfvars** is going to contain environment-specific (and possibly
sensitive) values, so it should be added to **.gitignore**.

**terraform.tf** is home to your
[Terraform-specific settings](https://www.terraform.io/docs/configuration/terraform.html).
This file will contain environment-specific values, so it should be added to
**.gitignore**. Unfortunately, `terraform` blocks
[can only contain constant values](https://www.terraform.io/docs/configuration/terraform.html#terraform-block-syntax);
they cannot reference variables defined in **terraform.tfvars**.

An example of using Terraform to deploy components can be found in the [`example` directory](https://github.com/nasa/cumulus/tree/master/example)
of the Cumulus repo.

## Remote State

From Terraform's [Remote State](https://www.terraform.io/docs/state/remote.html)
documentation:

> By default, Terraform stores state locally in a file named `terraform.tfstate`.
> When working with Terraform in a team, use of a local file makes Terraform
> usage complicated because each user must make sure they always have the latest
> state data before running Terraform and make sure that nobody else runs
> Terraform at the same time.
>
> With remote state, Terraform writes the state data to a remote data store,
> which can then be shared between all members of a team.

The recommended approach for handling remote state with Cumulus is to use the [S3 backend](https://www.terraform.io/docs/backends/types/s3.html).
This backend stores state in S3 and uses a DynamoDB table for locking.

See the deployment documentation for a [walkthrough of creating resources for your remote state using an S3 backend](README.md#create-resources-for-terraform-state).
