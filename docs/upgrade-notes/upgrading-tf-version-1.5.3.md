---
id: upgrade_tf_version_1.5.3
title: Upgrade to TF version 1.5.3
hide_title: false
---

## Background

Cumulus pins its support to a specific version of Terraform [see: deployment documentation](../deployment/README.md#install-terraform). The reason for only supporting one specific Terraform version at a time is to avoid deployment errors than can be caused by deploying to the same target with different Terraform versions.

Cumulus is upgrading its supported version of Terraform from **0.13.6** to **1.5.3**. This document contains instructions on how to perform the upgrade for your deployments.

### Prerequisites

- Follow the [Terraform guidance for what to do before upgrading](https://developer.hashicorp.com/terraform/language/upgrade-guides), notably ensuring that you have no pending changes to your Cumulus deployments before proceeding.
  - You should do a `terraform plan` to see if you have any pending changes for your deployment (for both the `data-persistence-tf`, `cumulus-tf` and `rds-cluster-tf` modules), and if so, run a `terraform apply` **before doing the upgrade to Terraform 1.5.3**
- Review the [Terraform v1.5 release notes](https://github.com/hashicorp/terraform/blob/v1.5/CHANGELOG.md) to prepare for any breaking changes that may affect your custom deployment code. **Cumulus' deployment code has already been updated for compatibility with version 1.5**.
- Install Terraform version 1.5.3. We recommend using Terraform Version Manager [tfenv](https://github.com/tfutils/tfenv) to manage your installed versons of Terraform, but this is not required.

### Upgrade your deployment

1. Ensure that you are running Terraform 1.5.3 by running `terraform --version`. If you are using `tfenv`, you can switch versions by running `tfenv use 1.5.3`.
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

      Even if Terraform says that no resource changes are pending, running the `apply` using Terraform version 1.5.3 will modify your backend state from version 0.13.6 to version 1.5.3 **without requiring approval**. Updating the backend state is a necessary part of the version 1.5.3 upgrade, but it is not completely transparent.

      :::
