---
id: import_cloudwatch_logs
title: Import Cloudwatch logs to Terraform State
hide_title: false
---

## Background

In Cumulus v15.0.0, configurable cloudwatch log groups have been added for all lambdas and existing cloudwatch log groups were changed in order to accept a retention period by the user upon deploying `data-persistence-tf` and `cumulus-tf`. In order to learn how to set these values please see [these instructions](../configuration/cloudwatch-retention.md).

## Import script

Upon re-deploying, an error `ResourceAlreadyExists` may arise for the cloudwatch log groups that have been created. This is because, since retention and new log groups were added, Terraform does not recognize them in its state. In order to remedy this, an import script `cloudwatch-import.sh` has been provided in both the `data-persistence-tf` and `cumulus-tf` directories to add the new existing resources into your terraform state. Switch to zsh from bash if you are on bash, run `zsh cloudwatch-import.sh` and follow the instructions.

## Important note when running the import script

The module names for the cloudwatch log groups may be different from what is defined in the script, as it varies from user to user across the DAACS. Please check `terraform plan` or `terraform state show` in order to figure out these values and change the script accordingly to what they are if they differ from the existing `cumulus` modules. Also, there may be log groups that are not applicable to you or result in `Error: Resource already managed by Terraform`, simply comment them out and re-run the script.

More information is available about the cloudwatch import script [here](../upgrade-notes/import-cloudwatch-logs.md)
