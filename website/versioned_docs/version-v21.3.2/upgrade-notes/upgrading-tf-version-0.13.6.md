---
id: upgrade_tf_version_0.13.6
title: Upgrade to TF version 0.13.6
hide_title: false
---

## Background

Cumulus pins its support to a specific version of Terraform [see: deployment documentation](../deployment/README.md#install-terraform). The reason for only supporting one specific Terraform version at a time is to avoid deployment errors than can be caused by deploying to the same target with different Terraform versions.

Cumulus is upgrading its supported version of Terraform from **0.12.12** to **0.13.6**. This document contains instructions on how to perform the upgrade for your deployments.

### Prerequisites

- Follow the [Terraform guidance for what to do before upgrading](https://www.terraform.io/upgrade-guides/0-13.html#before-you-upgrade), notably ensuring that you have no pending changes to your Cumulus deployments before proceeding.
  - You should do a `terraform plan` to see if you have any pending changes for your deployment (for both the `data-persistence-tf` and `cumulus-tf` modules), and if so, run a `terraform apply` **before doing the upgrade to Terraform 0.13.6**
- Review the [Terraform v0.13 release notes](https://github.com/hashicorp/terraform/blob/v0.13/CHANGELOG.md) to prepare for any breaking changes that may affect your custom deployment code. **Cumulus' deployment code has already been updated for compatibility with version 0.13**.
- Install Terraform version 0.13.6. We recommend using Terraform Version Manager [tfenv](https://github.com/tfutils/tfenv) to manage your installed versons of Terraform, but this is not required.

### Upgrade your deployment code

Terraform 0.13 does not support some of the syntax from previous Terraform versions, so you need to upgrade your deployment code for compatibility.

Terraform provides a [`0.13upgrade` command](https://www.terraform.io/docs/commands/0.13upgrade.html) as part of version 0.13 to handle automatically upgrading your code. **Make sure to check out the [documentation on batch usage of `0.13upgrade`](https://www.terraform.io/docs/commands/0.13upgrade.html#batch-usage), which will allow you to upgrade all of your Terraform code with one command**.

Run the `0.13upgrade` command until you have no more necessary updates to your deployment code.

### Upgrade your deployment

1. Ensure that you are running Terraform 0.13.6 by running `terraform --version`. If you are using `tfenv`, you can switch versions by running `tfenv use 0.13.6`.
2. For the `data-persistence-tf` and `cumulus-tf` directories, take the following steps:
   1. Run `terraform init --reconfigure`. The `--reconfigure` flag is required, otherwise you might see an error like:

        ```text
        Error: Failed to decode current backend config

        The backend configuration created by the most recent run of "terraform init"
        could not be decoded: unsupported attribute "lock_table". The configuration
        may have been initialized by an earlier version that used an incompatible
        configuration structure. Run "terraform init -reconfigure" to force
        re-initialization of the backend.
        ```

   2. Run `terraform apply` to perform a deployment.

      :::caution

      Even if Terraform says that no resource changes are pending, running the `apply` using Terraform version 0.13.6 will modify your backend state from version 0.12.12 to version 0.13.6 **without requiring approval**. Updating the backend state is a necessary part of the version 0.13.6 upgrade, but it is not completely transparent.

      :::
