---
id: thin_egress_app
title: Using the Thin Egress App (TEA) for Cumulus Distribution
hide_title: false
---

The [Thin Egress App (TEA)](https://github.com/asfadmin/thin-egress-app) is an app running in Lambda that allows retrieving data from S3 using temporary links and provides URS integration.

## Configuring a TEA Deployment

TEA is deployed using [Terraform](https://terraform.io) modules. Refer to [these instructions](./components) for guidance on how to integrate new components with your deployment.

The `cumulus-template-deploy` repository `cumulus-tf/main.tf` contains a `thin_egress_app` for distribution.

The TEA module provides [these instructions](https://github.com/asfadmin/thin-egress-app/blob/devel/NGAP-DEPLOY-README.MD)
showing how to add it to your deployment and the following are instructions to configure the `thin_egress_app` module in your Cumulus deployment.

### Create a Secret for Signing Thin Egress App JWTs

The Thin Egress App uses JSON Web Tokens (JWTs) internally to authenticate requests and requires a secret stored in AWS Secrets Manager containing SSH keys that are used to sign the JWTs.

See the [Thin Egress App documentation](https://github.com/asfadmin/thin-egress-app#jwt-cookie-secret) on how to create this secret with the correct values. It will be used later to set the `thin_egress_jwt_secret_name` variable when deploying the Cumulus module.

### Bucket_map.yaml

The Thin Egress App uses a `bucket_map.yaml` file to determine which buckets to
serve. Documentation of the file format is available [here](https://github.com/asfadmin/thin-egress-app#bucket-map).

The default Cumulus module generates a file at `s3://${system_bucket}/distribution_bucket_map.json`.

The configuration file is a simple JSON mapping of the form:

```json
{
  "daac-public-data-bucket": "/path/to/this/kind/of/data"
}
```

:::info

Cumulus only supports a one-to-one mapping of bucket->TEA path for 'distribution' buckets.

:::

#### Optionally Configure a Custom Bucket Map

A simple configuration would look something like this:

##### bucket_map.yaml

```yaml
MAP:
  my-protected: my-protected
  my-public: my-public

PUBLIC_BUCKETS:
  - my-public
```

:::caution

Your custom bucket map **must include mappings for all of the `protected` and `public` buckets specified in the `buckets` variable in `cumulus-tf/terraform.tfvars`**, otherwise Cumulus may not be able to determine the correct distribution URL for ingested files and you may encounter errors.

:::

### Optionally Configure Shared Variables

The `cumulus` module deploys certain components that interact with TEA. As a result, the `cumulus` module requires that if you are specifying a value for the `stage_name` variable to the TEA module, you **must use the same value for the `tea_api_gateway_stage` variable to the `cumulus` module**.

One way to keep these variable values in sync across the modules is to use [Terraform local values](https://www.terraform.io/docs/configuration/locals.html) to define values to use for the variables for both modules. This approach is shown in the [Cumulus Core example deployment code](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/main.tf).
