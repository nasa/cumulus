---
id: troubleshoot_deployment
title: Troubleshooting
hide_title: true
---

# Troubleshooting

This document provides 'notes' on frequently encountered deployment issues. The issues reported are organized by relevant subsection.

## Deploying data persistence resources

### `Invalid index: aws_elasticsearch_domain.es_vpc[0] is empty tuple`

You may see this error if the Elasticsearch domain tracked by your Terraform state cannot be found or no longer exists. This could happen if you have accidentally deleted your Elasticsearch domain, producing an error on your next `terraform apply` that looks something like:

```plain
Error: Invalid index

  on ../../tf-modules/data-persistence/elasticsearch.tf line 144, in resource "aws_elasticsearch_domain_policy" "es_vpc_domain_policy":
 144:       "Resource": "${aws_elasticsearch_domain.es_vpc[[0].arn}/*"
    ----------------
     aws_elasticsearch_domain.es_vpc[0] is empty tuple

The given key does not identify an element in this collection value.
```

To resolve this issue, you need to manually remove the entry from your Terraform state referencing the missing resource:

```bash
$ terraform state rm module.data_persistence.aws_elasticsearch_domain.es_vpc
Removed module.data_persistence.aws_elasticsearch_domain.es_vpc[0]
Successfully removed 1 resource instance(s).
```

After removing that entry from the Terraform state, `terraform apply` should work correctly.

## Deploying Cumulus

### `The provided execution role does not have permissions to call SendMessage on SQS`

You may see this error the first time you run `terraform apply` for your Cumulus deployment.

**Cause:** The Amazon service for managing roles and permissions, IAM, [is eventually consistent](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_general.html#troubleshoot_general_eventual-consistency), meaning there can be a delay between when permission updates are applied and when they actually take effect. As a result, when doing a Terraform deployment the role permissions required for a resource may not have fully taken effect before Terraform attempts to create that resource, so the deployment fails.

**Solution:** Re-run `terraform apply` and the problem should not recur.

### `ValidationException: You must specify exactly one subnet.` when deploying the data-persistence module

This can happen if you have multiple `subnet_ids` configured for your
`data-persistence` modules, but your config is only creating one
Elasticsearch instance. To fix the issue, update the `elasticsearch_config`
variable for your `data-persistence` module to increase the number of instances:

```hcl
{
  domain_name    = "es"
  instance_count = 2
  instance_type  = "t2.small.elasticsearch"
  version        = "5.3"
  volume_size    = 10
}
```

## Install dashboard

### Dashboard configuration

Issues:

- **Problem clearing the cache: EACCES: permission denied, rmdir '/tmp/gulp-cache/default'**", this probably means the files at that location, and/or the folder, are owned by someone else (or some other factor prevents you from writing there).

It's possible to workaround this by editing the file `cumulus-dashboard/node_modules/gulp-cache/index.js` and alter the value of the line `var fileCache = new Cache({cacheDirName: 'gulp-cache'});` to something like `var fileCache = new Cache({cacheDirName: '<prefix>-cache'});`. Now gulp-cache will be able to write to `/tmp/<prefix>-cache/default`, and the error should resolve.

### Dashboard deployment

Issues:

- If the dashboard sends you to an Earthdata Login page that has an error reading **"Invalid request, please verify the client status or redirect_uri before resubmitting"**, this means you've either forgotten to update one or more of your EARTHDATA_CLIENT_ID, EARTHDATA_CLIENT_PASSWORD environment variables (from your app/.env file) and re-deploy Cumulus, or you haven't placed the correct values in them, or you've forgotten to add both the "redirect" and "token" URL to the Earthdata Application.
- There is odd caching behavior associated with the dashboard and Earthdata Login at this point in time that can cause the above error to reappear on the Earthdata Login page loaded by the dashboard even after fixing the cause of the error. If you experience this, attempt to access the dashboard in a new browser window, and it should work.
