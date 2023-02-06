---
id: version-v9.3.0-cumulus_distribution
title: Using the Cumulus Distribution API
hide_title: false
original_id: cumulus_distribution
---

The Cumulus Distribution API is a set of endpoints that can be used to enable AWS Cognito authentication when downloading data from S3.

## Configuring a Cumulus Distribution deployment

The Cumulus Distribution API is included in the main [Cumulus](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus_distribution) repo. It is available as part of the `terraform-aws-cumulus.zip` archive in the [latest release](https://github.com/nasa/cumulus/releases).

These steps assume you're using [the Cumulus Deployment Template](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/main.tf) but can also be used for custom deployments.

To configure a deployment to use Cumulus Distribution:

 1. Remove or comment the "Thin Egress App Settings" in [the Cumulus Template Deploy](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/main.tf) and enable the Cumulus Distribution settings.
 2. Delete or comment the contents of [thin_egress_app.tf](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/thin_egress_app.tf) and the corresponding Thin Egress App outputs in [outputs.tf](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/outputs.tf). These are not necessary for a Cumulus Distribution deployment.
 3. Uncomment the Cumulus Distribution outputs in [outputs.tf](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/outputs.tf).
 4. Rename `cumulus-template-deploy/cumulus-tf/cumulus_distribution.tf.example` to `cumulus-template-deploy/cumulus-tf/cumulus_distribution.tf`.
 5. Set the Cumulus Distribution variables in your `terraform.tfvars` (which is based on [terraform.tfvars.example](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/terraform.tfvars.example)). These include:

- deploy_cumulus_distribution
- cumulus_distribution_url
- csdap_client_id
- csdap_client_password
- csdap_host_url
- any others under the `Cumulus Distribution Variables` section in the example

## S3 Bucket Mapping

The Cumulus Distribution API uses a `bucket_map.yaml` or `bucket_map.yaml.tmpl` file to determine which buckets to
serve. [See the examples](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf/cumulus_distribution).

The default Cumulus module generates a file at `s3://${system_bucket}/distribution_bucket_map.json`.

The configuration file is a simple json mapping of the form:

```json
{
  "daac-public-data-bucket": "/path/to/this/kind/of/data"
}
```

> Note: Cumulus only supports a one-to-one mapping of bucket -> Cumulus Distribution path for 'distribution' buckets. Also, the bucket map **must include mappings for all of the `protected` and `public` buckets specified in the `buckets` variable in `cumulus-tf/terraform.tfvars`**, otherwise Cumulus may not be able to determine the correct distribution URL for ingested files and you may encounter errors.

## Switching from the Thin Egress App to Cumulus Distribution

If you have previously deployed the Thin Egress App (TEA) as your distribution app, you can switch to Cumulus Distribution by following the steps above.

Note, however, that the `cumulus_distribution` module will generate a bucket map cache and overwrite any existing bucket map caches created by TEA.

There will also be downtime while your API gateway is updated.
