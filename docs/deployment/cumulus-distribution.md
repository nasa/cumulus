---
id: cumulus_distribution
title: Using the Cumulus Distribution API
hide_title: false
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

- `deploy_cumulus_distribution`: Set to `true` if deploying the Cumulus Distribution API or `false` if deploying TEA.
- `cumulus_distribution_url`: Used to override the CloudFront/API Gateway URL. This can be used if you need to insert a port for port forwarding. Not all users will need to set this and, if you do require it, it will need to be set _after_ an initial deployment. The process would be:
  1. Deploy once without `cumulus_distribution_url` set
  2. Note the API Gateway or CloudFront URL that's provided for the new Cumulus Distribution API after a successful deployment
  3. Enter that URL plus a port for `cumulus_distribution_url`. e.g. `cumulus_distribution_url = "https://abc123.execute-api.us-east-1.amazonaws.com:7000/dev/"`
- `csdap_client_id`: The Client ID of your AWS account's Cognito setup. Created and managed outside of Cumulus.
- `csdap_client_password`: The client password for your AWS account's Cognito setup. Created and managed outside of Cumulus.
- `csdap_host_url`: The host URL of your AWS account's Cognito setup. Created and managed outside of Cumulus.
- any others under the `Cumulus Distribution Variables` section in the example

## S3 Bucket Mapping

An S3 Bucket map allows users to abstract bucket names. If the bucket names change at any point, only the bucket map would need to be updated instead of every S3 link.

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
