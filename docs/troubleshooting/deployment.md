---
id: troubleshooting-deployment
title: Troubleshooting your deployment
hide_title: true
---

# Troubleshooting your deployment

## `The provided execution role does not have permissions to call SendMessage on SQS`

You may see this error the first time you run `terraform apply` for your Cumulus deployment.

**Cause:** The Amazon service for managing roles and permissions, IAM, [is eventually consistent](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_general.html#troubleshoot_general_eventual-consistency), meaning there can be a delay between when permission updates are applied and when they actually take effect. As a result, when doing a Terraform deployment the role permissions required for a resource may not have fully taken effect before Terraform attempts to create that resource, so the deployment fails.

**Solution:** Re-run `terraform apply` and the problem should not recur.
