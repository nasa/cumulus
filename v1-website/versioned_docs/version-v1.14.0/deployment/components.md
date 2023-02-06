---
id: version-v1.14.0-components
title: Cumulus Components
hide_title: true
original_id: components
---

# Component-based Cumulus Deployment

Cumulus is moving toward a more modular architecture, which will allow users to
pick and choose the individual components that they want to deploy. These
components will be made available as [Terraform modules](https://www.terraform.io/docs/modules/index.html).
Cumulus users will be able to add those individual components to their
deployment and link them together using Terraform. In addition, users will be
able to make use of the large number of publicly available modules on the [Terraform Module Registry](https://registry.terraform.io/).

This document assumes familiarity with Terraform. If you are not comfortable
working with Terraform, the following links should bring you up to speed:

* [Introduction to Terraform](https://www.terraform.io/intro/index.html)
* [Getting Started with Terraform and AWS](https://learn.hashicorp.com/terraform/?track=getting-started#getting-started)
* [Terraform Configuration Language](https://www.terraform.io/docs/configuration/index.html)

⚠️ Cumulus Terraform modules are targetted at Terraform v0.12.0 and higher.  To verify that the version of Terraform installed is at least v0.12.0, run:

```shell
$ terraform --version
Terraform v0.12.2
```

## Adding Terraform to your deployment

Although Terraform can be configured using a single file, it is recommended to
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

It is highly recommended that you enable bucket versioning on the S3 bucket to
allow for state recovery in the case of accidental deletions and human error.
Bucket versioning can be enabled with the following AWS CLI command:

```shell
$ aws s3api put-bucket-versioning \
    --bucket my-tf-state-bucket \
    --versioning-configuration Status=Enabled
```

The S3 backend provides state locking and consistency checking using a DynamoDB
table. That table can be created with the following command:

```shell
$ aws dynamodb create-table \
    --table-name my-tf-locks-table \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST
```

Terraform can be configured to use the S3 backend by adding the following to
your deployment's Terraform config. If following the file layout [described above](#adding-terraform-to-your-deployment),
this should be added to your **terraform.tf** file.

```hcl
terraform {
  backend "s3" {
    region         = "us-east-1"
    bucket         = "my-tf-state-bucket"
    key            = "terraform.tfstate"
    dynamodb_table = "my-tf-locks-table"
  }
}
```

## Available Cumulus Components

* [Cumulus Distribution](./distribution_component) - the Thin Egress App, as
  well as the S3 credentials endpoint, with a config targeted at Cumulus and
  NGAP.
* [Thin Egress App](./thin_egress_app) - an app running in lambda that creates
  temporary S3 links and provides URS integration.
