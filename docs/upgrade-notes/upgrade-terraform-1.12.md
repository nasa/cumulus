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

Prior to updating terraform you should deploy to the release prior to this update.    Updating from prior versions directly to this release *may* work, but have not been extensively tested.

Prior to executing these steps you should have terraform v1.12.2 active in your deployment environment.

This document assumes you are using terraform remote states as recommended in the Cumulus deploy documentation.

#### Terraform Init

Attempting to run terraform init/updates may result in an error message similar to:

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

To 'upgrade', run the following:

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

### Terraform Plan/Apply

Once this has run, you can run `terraform plan` and/or `terraform apply` as you normally would.
