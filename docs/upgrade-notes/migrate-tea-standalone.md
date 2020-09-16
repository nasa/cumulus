---
id: migrate_tea_standalone
title: Migrate TEA deployment to standalone module
hide_title: false
---

## Background

Previous versions of Cumulus included deployment of the Thin Egress App (TEA) by default in the `distribution` module. As a result, this forced Cumulus users who wanted to deploy a new version of TEA to wait on a new release of Cumulus that incorporated that release.

In order to give Cumulus users the flexibility to deploy newer versions of TEA whenever they want, deployment of TEA has been removed from the `distribution` module and **Cumulus users must now add the TEA module to their deployment**. [Guidance on integrating the TEA module to your deployment is provided](deployment/thin-egress-app.md), or you can refer to [Cumulus core example deployment code](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/main.tf).

By default, when upgrading Cumulus and moving from TEA deployed via the `distribution` module to deployed as a separate module, your API gateway for TEA would be destroyed and re-created, which could cause outages for any Cloudfront endpoints pointing at that API gateway.

These instructions outline how to modify your state to preserve your existing Thin Egress App (TEA) API gateway when upgrading Cumulus and moving deployment of TEA to a standalone module.

## Notes about state management

These instructions will involve manipulating your Terraform state via `terraform state mv` commands. These operations are **extremely dangerous**, since a mistake in editing your Terraform state can leave your stack in a corrupted state where deployment may be impossible or may result in unanticipated resource deletion.

To mitigate the risk of having to edit your state, we **recommend temporarily switching your deployment to read from local state**. Switching to local state means that changes to Terraform state are only tracked locally, not on your remote state stored in S3. Thus, if you make a mistake, you can abandon the state changes by switching your deployment to read from its remote state.

### Switch from remote to local state

In your `cumulus-tf` directory:

1. Edit `terraform.tf` to comment out your backend settings
2. Re-run `terraform init` and answer "yes" when asked to copy backend configuration

![Screenshot of terminal showing output from "terraform init" to switch from remote state to local state](assets/switch-to-local-state.png)

### Switch from local to remote state

In your `cumulus-tf` directory:

1. Edit `terraform.tf` to un-comment your backend settings
2. Re-run `terraform init` and answer "yes"/"no":
   - Answer "yes" if your changes to local state all applied as expected and you want to sync them to your remote state
   - Answer "no" if something when wrong when editing your local state and you want to revert back to your remote state before any changes were made

## Migration instructions

1. Ensure that you are working with [local state](#switch-from-remote-to-local-state)
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

4. Run the state modification commands. They must be run in exactly this order:

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

    # Move bucket map
    terraform state mv module.cumulus.module.distribution.aws_s3_bucket_object.bucket_map_yaml[0] aws_s3_bucket_object.bucket_map_yaml

    # Move TEA Cloudformation stack
    terraform state mv module.cumulus.module.distribution.module.thin_egress_app.aws_cloudformation_stack.thin_egress_app module.thin_egress_app.aws_cloudformation_stack.thin_egress_app
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

    If you still see deletion of `module.cumulus.module.distribution.module.thin_egress_app.aws_cloudformation_stack.thin_egress_app` pending, then something went wrong and you need to restore your [previous remote state](#switch-from-local-to-remote-state) and start over from step 1. Otherwise, proceed to step 6.

6. Once you have confirmed that everything looks as expected, run `terraform apply`.
7. Visit the same API gateway from step 1 and confirm that it still works.
8. [Re-enable your remote state and copy the local state to your remote to sync the changes](#switch-from-local-to-remote-state)

Your TEA deployment has now been migrated to a standalone module, which gives you the ability to upgrade the deployed version of TEA independently of Cumulus releases.
