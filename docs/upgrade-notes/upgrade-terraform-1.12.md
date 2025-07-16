---
id: upgrade-terraform-1.12
title: Upgrade to Terraform 1.12
hide_title: false
---

## Background

The release of Cumulus (VERSION) updates Terraform to require use of Terraform v1.12.2 and the AWS provider to at least 5.100 (but not 6).

This upgrade requires updates to your deployment environment (updating to use Terraform 1.12.2), as well as manually tested deployment steps to upgrade your deployment.    This document provides an upgrade example assuming manual deployment via the terraform command line.    These steps should be followed for *each* terraform stack deployed as part of your cumulus deployment.

### Deployment Steps

### Prerequisites

- Follow the [Terraform guidance for what to do before upgrading](https://developer.hashicorp.com/terraform/language/upgrade-guides), reviewing all the changes from 1.5.3 to 1.12 with respect to any custom/outside Cumulus terraform code, **notably ensuring that you have no pending changes to your Cumulus deployments before proceeding**.
- Prior to updating terraform you should deploy to the release prior to this update.    Updating from prior versions directly to this release *may* work, but have not been extensively tested.
- You should do a `terraform plan` to see if you have any pending changes for your deployment (for the `data-persistence-tf`, `cumulus-tf` and `rds-cluster-tf` modules), and if so, run a `terraform apply` **before doing the upgrade to Terraform 1.12.2**
- Install Terraform version 1.12.2. We recommend using Terraform Version Manager [tfenv](https://github.com/tfutils/tfenv) to manage your installed versons of Terraform, but this is not required.
- Ensure that you are running the correct version of Terraform by running `terraform --version`. If you are using `tfenv`, you can switch versions by running `tfenv use 1.12.2`.
- This document assumes you are using terraform remote states as recommended in the Cumulus deploy documentation
- This document requires that you evaluate all custom code/external modules being deployed in combination with Cumulus Core that are not part of the Cumulus Core project.      Core has tested Orca v10.0.1 as part of our integration tests only.

### Upgrade your deployment using `terraform init`

For each stack you are deploying, you will need to either:

- Run `terraform init` in absence of local terraform state/configuration.  This should update the remote state and allow a `terraform apply` to proceed with the new version of Terraform.    This is most likely in CI/one-off deployment environments without persistent storage.

*or*

- If you are running in an environment with a stored local plugins/state in your `.terraform` directory, run `terraform init --reconfigure`.   Details are as follows:


#### Terraform Init Reconfigure

Attempting to run terraform init/updates with local Terraform configuration  information from a prior deployment will result in an error message similar to:

```bash
->terraform init
Initializing the backend...
Initializing modules...
╷
│ Error: Backend configuration changed
│
│ A change in the backend configuration has been detected, which may require migrating existing state.
│
│ If you wish to attempt automatic migration of the state, use "terraform init -migrate-state".
│ If you wish to store the current configuration with no changes to the state, use "terraform init -reconfigure".
╵
```

This is due to changes made in Terraform as part of release 1.10 and 1.8:

- <https://developer.hashicorp.com/terraform/language/v1.8.x/upgrade-guides>
- <https://developer.hashicorp.com/terraform/language/v1.10.x/upgrade-guides>

To 'upgrade', either remove the local configuration *or* run the following:

```bash
-> terraform init --reconfigure

Initializing the backend...

Successfully configured the backend "s3"! Terraform will automatically
use this backend unless the backend configuration changes.
Initializing modules...
Initializing provider plugins...
- terraform.io/builtin/terraform is built in to Terraform
- Reusing previous version of hashicorp/aws from the dependency lock file
- Reusing previous version of hashicorp/random from the dependency lock file
- Reusing previous version of hashicorp/null from the dependency lock file
- Using previously-installed hashicorp/aws v5.100.0
- Using previously-installed hashicorp/random v3.7.2
- Using previously-installed hashicorp/null v3.1.1

Terraform has been successfully initialized!

You may now begin working with Terraform. Try running "terraform plan" to see
any changes that are required for your infrastructure. All Terraform commands
should now work.

If you ever set or change modules or backend configuration for Terraform,
rerun this command to reinitialize your working directory. If you forget, other
commands will detect it and remind you to do so if necessary.
```


### Validation

Validation of the current statefile version can be done via the command line:

```bash
terraform show -json | jq '.terraform_version'
```

If the upgrade was successful this should result in output like:

```bash
"1.12.2"
```

### Terraform Plan/Apply

Once your terraform state has been updated, you can run `terraform plan` and/or `terraform apply` as you normally would.
