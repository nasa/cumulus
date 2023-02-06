---
id: version-v3.0.0-migrate_tea_standalone
title: Migrate TEA deployment to standalone module
hide_title: false
original_id: migrate_tea_standalone
---

## Background

> This document is only relevant for upgrades of Cumulus from versions < 3.x.x to versions > 3.x.x

Previous versions of Cumulus included deployment of the Thin Egress App (TEA) by default in the `distribution` module. As a result, Cumulus users who wanted to deploy a new version of TEA to wait on a new release of Cumulus that incorporated that release.

In order to give Cumulus users the flexibility to deploy newer versions of TEA whenever they want, deployment of TEA has been removed from the `distribution` module and **Cumulus users must now add the TEA module to their deployment**. [Guidance on integrating the TEA module to your deployment is provided](../deployment/thin-egress-app.md), or you can refer to [Cumulus core example deployment code for the `thin_egress_app` module](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/main.tf).

By default, when upgrading Cumulus and moving from TEA deployed via the `distribution` module to deployed as a separate module, your API gateway for TEA would be destroyed and re-created, which could cause outages for any Cloudfront endpoints pointing at that API gateway.

These instructions outline how to modify your state to preserve your existing Thin Egress App (TEA) API gateway when upgrading Cumulus and moving deployment of TEA to a standalone module. **If you do not care about preserving your API gateway for TEA when upgrading your Cumulus deployment, you can skip these instructions.**

## Prerequisites

- You [**must have bucket versioning enabled** for the Terraform state bucket used by your `cumulus` deployment](../deployment/terraform-best-practices#enable-bucket-versioning)

## Notes about state management

These instructions will involve manipulating your Terraform state via `terraform state mv` commands. These operations are **extremely dangerous**, since a mistake in editing your Terraform state can leave your stack in a corrupted state where deployment may be impossible or may result in unanticipated resource deletion.

Since bucket versioning preserves a separate version of your state file each time it is written, and the Terraform state modification commands overwrite the state file, we can mitigate the risk of these operations by downloading the most recent state file before starting the upgrade process. Then, if anything goes wrong during the upgrade, we can restore that previous state version. Guidance on how to perform both operations is provided below.

### Download your most recent state version

Run this command to download the most recent cumulus deployment state file, replacing `BUCKET` and `KEY` with the correct values from `cumulus-tf/terraform.tf`:

```shell
 aws s3 cp s3://BUCKET/KEY /path/to/terraform.tfstate
```

### Restore a previous state version

Upload the state file that was previously downloaded to the bucket/key for your state file, replacing `BUCKET` and `KEY` with the correct values from `cumulus-tf/terraform.tf`:

```shell
 aws s3 cp /path/to/terraform.tfstate s3://BUCKET/KEY
```

Then run `terraform plan`, which will give an error because we manually overwrote the state file and it is now out of sync with the lock table Terraform uses to track your state file:

```shell
Error: Error loading state: state data in S3 does not have the expected content.

This may be caused by unusually long delays in S3 processing a previous state
update.  Please wait for a minute or two and try again. If this problem
persists, and neither S3 nor DynamoDB are experiencing an outage, you may need
to manually verify the remote state and update the Digest value stored in the
DynamoDB table to the following value: <some-digest-value>
```

To resolve this error, run this command and replace `DYNAMO_LOCK_TABLE`, `BUCKET` and `KEY` with the correct values from `cumulus-tf/terraform.tf`, and use the digest value from the previous error output:

```shell
 aws dynamodb put-item \
    --table-name DYNAMO_LOCK_TABLE \
    --item '{
        "LockID": {"S": "BUCKET/KEY-md5"},
        "Digest": {"S": "some-digest-value"}
      }'
```

Now, if you re-run `terraform plan`, it should work as expected.

## Migration instructions

> **Please note:** These instructions assume that you are deploying the `thin_egress_app` module as shown in the [Cumulus core example deployment code](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/main.tf)

1. Ensure that you have [downloaded the latest version of your state file for your cumulus deployment](#download-your-most-recent-state-version)
2. Find the URL for your `<prefix>-thin-egress-app-EgressGateway` API gateway. Confirm that you can access it in the browser and that it is functional.
3. Run `terraform plan`. You should see output like (edited for readability):

    ```shell
    # module.thin_egress_app.aws_cloudformation_stack.thin_egress_app will be created
      + resource "aws_cloudformation_stack" "thin_egress_app" {

    # module.thin_egress_app.aws_s3_bucket.lambda_source will be created
      + resource "aws_s3_bucket" "lambda_source" {

    # module.thin_egress_app.aws_s3_bucket_object.cloudformation_template will be created
      + resource "aws_s3_bucket_object" "cloudformation_template" {

    # module.thin_egress_app.aws_s3_bucket_object.lambda_code_dependency_archive will be created
      + resource "aws_s3_bucket_object" "lambda_code_dependency_archive" {

    # module.thin_egress_app.aws_s3_bucket_object.lambda_source will be created
      + resource "aws_s3_bucket_object" "lambda_source" {

    # module.thin_egress_app.aws_security_group.egress_lambda[0] will be created
      + resource "aws_security_group" "egress_lambda" {

    ...

    # module.cumulus.module.distribution.module.thin_egress_app.aws_cloudformation_stack.thin_egress_app will be destroyed
      - resource "aws_cloudformation_stack" "thin_egress_app" {

    # module.cumulus.module.distribution.module.thin_egress_app.aws_s3_bucket.lambda_source will be destroyed
      - resource "aws_s3_bucket" "lambda_source" {

    # module.cumulus.module.distribution.module.thin_egress_app.aws_s3_bucket_object.cloudformation_template will be destroyed
      - resource "aws_s3_bucket_object" "cloudformation_template" {

    # module.cumulus.module.distribution.module.thin_egress_app.aws_s3_bucket_object.lambda_code_dependency_archive will be destroyed
      - resource "aws_s3_bucket_object" "lambda_code_dependency_archive" {

    # module.cumulus.module.distribution.module.thin_egress_app.aws_s3_bucket_object.lambda_source will be destroyed
      - resource "aws_s3_bucket_object" "lambda_source" {

    # module.cumulus.module.distribution.module.thin_egress_app.aws_security_group.egress_lambda[0] will be destroyed
      - resource "aws_security_group" "egress_lambda" {
    ```

4. Run the state modification commands. The commands must be run in exactly this order:

   ```shell
    # Move security group
    terraform state mv module.cumulus.module.distribution.module.thin_egress_app.aws_security_group.egress_lambda module.thin_egress_app.aws_security_group.egress_lambda

    # Move TEA storage bucket
    terraform state mv module.cumulus.module.distribution.module.thin_egress_app.aws_s3_bucket.lambda_source module.thin_egress_app.aws_s3_bucket.lambda_source

    # Move TEA lambda source code
    terraform state mv module.cumulus.module.distribution.module.thin_egress_app.aws_s3_bucket_object.lambda_source module.thin_egress_app.aws_s3_bucket_object.lambda_source

    # Move TEA lambda dependency code
    terraform state mv module.cumulus.module.distribution.module.thin_egress_app.aws_s3_bucket_object.lambda_code_dependency_archive module.thin_egress_app.aws_s3_bucket_object.lambda_code_dependency_archive

    # Move TEA Cloudformation template
    terraform state mv module.cumulus.module.distribution.module.thin_egress_app.aws_s3_bucket_object.cloudformation_template module.thin_egress_app.aws_s3_bucket_object.cloudformation_template

    # Move URS creds secret version
    terraform state mv module.cumulus.module.distribution.aws_secretsmanager_secret_version.thin_egress_urs_creds aws_secretsmanager_secret_version.thin_egress_urs_creds

    # Move URS creds secret
    terraform state mv module.cumulus.module.distribution.aws_secretsmanager_secret.thin_egress_urs_creds aws_secretsmanager_secret.thin_egress_urs_creds

    # Move TEA Cloudformation stack
    terraform state mv module.cumulus.module.distribution.module.thin_egress_app.aws_cloudformation_stack.thin_egress_app module.thin_egress_app.aws_cloudformation_stack.thin_egress_app
   ```

    Depending on how you were supplying a bucket map to TEA, there may be an additional step. If you were specifying the `bucket_map_key` variable to the `cumulus` module to use a custom bucket map, then you can ignore this step and just ensure that the `bucket_map_file` variable to the TEA module uses that same S3 key. Otherwise, if you were letting Cumulus generate a bucket map for you, then you need to take this step to migrate that bucket map:

    ```shell
    # Move bucket map
    terraform state mv module.cumulus.module.distribution.aws_s3_bucket_object.bucket_map_yaml[0] aws_s3_bucket_object.bucket_map_yaml
    ```

5. Run `terraform plan` again. You may still see a few additions/modifications pending like below, but you should not see any deletion of Thin Egress App resources pending:

    ```shell
    # module.thin_egress_app.aws_cloudformation_stack.thin_egress_app will be updated in-place
      ~ resource "aws_cloudformation_stack" "thin_egress_app" {

    # module.thin_egress_app.aws_s3_bucket_object.cloudformation_template will be updated in-place
      ~ resource "aws_s3_bucket_object" "cloudformation_template" {

    # module.thin_egress_app.aws_s3_bucket_object.lambda_code_dependency_archive will be updated in-place
      ~ resource "aws_s3_bucket_object" "lambda_code_dependency_archive" {

    # module.thin_egress_app.aws_s3_bucket_object.lambda_source will be updated in-place
      ~ resource "aws_s3_bucket_object" "lambda_source" {
    ```

    If you still see deletion of `module.cumulus.module.distribution.module.thin_egress_app.aws_cloudformation_stack.thin_egress_app` pending, then something went wrong and you should [restore the previously downloaded state file version](#restore-a-previous-state-version) and start over from step 1. Otherwise, proceed to step 6.

6. Once you have confirmed that everything looks as expected, run `terraform apply`.
7. Visit the same API gateway from step 1 and confirm that it still works.

Your TEA deployment has now been migrated to a standalone module, which gives you the ability to upgrade the deployed version of TEA independently of Cumulus releases.
