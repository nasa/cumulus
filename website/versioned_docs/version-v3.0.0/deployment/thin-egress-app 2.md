---
id: version-v3.0.0-thin_egress_app
title: Using the Thin Egress App for Cumulus distribution
hide_title: false
original_id: thin_egress_app
---

The [Thin Egress App (TEA)](https://github.com/asfadmin/thin-egress-app) is an app running in Lambda that allows retrieving data from S3 using temporary links and provides URS integration.

## Configuring a TEA deployment

TEA is deployed using [Terraform](https://terraform.io) modules. Refer to [these instructions](./components) for guidance on how to integrate new components with your deployment.

The TEA module provides [these instructions](https://github.com/asfadmin/thin-egress-app/blob/devel/NGAP-DEPLOY-README.MD)
showing how to add it to your deployment.

Below are some Cumulus-specific tips:

### bucket_map.yaml

The Thin Egress App uses a `bucket_map.yaml` file to determine which buckets to
serve. Documentation of the file format is available [here](https://github.com/asfadmin/thin-egress-app#bucket-map).

A simple config would look something like this:

**bucket_map.yaml:**

```yaml
MAP:
  my-protected: my-protected
  my-public: my-public

PUBLIC_BUCKETS:
  - my-public
```

> Please note: your custom bucket map **must include mappings for all of the `protected` and `public` buckets specified in the `buckets` variable in `cumulus-tf/terraform.tfvars`**, otherwise Cumulus may not be able to determine the correct distribution URL for ingested files and you may encounter errors

### Integration with cumulus module

The `cumulus` module deploys certain components that interact with TEA. As a result, the `cumulus` module requires a `tea_stack_name` variable which is the name of the TEA Cloudformation stack. **This value must match the value of the `stack_name` variable for the TEA module**.

Also, if you are specifying a value for the `stage_name` variable to the TEA module, you **must use the same value for the `tea_api_gateway_stage` variable to the `cumulus` module**.

One way to keep these variable values in sync across the modules is to use [Terraform local values](https://www.terraform.io/docs/configuration/locals.html) to define values to use for the variables for both modules. This approach is shown in the [Cumulus core example deployment code](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/main.tf).

### Earthdata Login credentials

The Thin Egress App stores its Earthdata Login credentials in AWS Secrets
Manager. There are two values stored in the secret: `UrsId` and `UrsAuth`.

The `UrsId` is the URS client id. If you're unsure what that value is, it's
stored as `EARTHDATA_CLIENT_ID` in your `app/.env` file.

The value of `UrsAuth` is going to be your Earthdata Client ID joined to your
Earthdata Client password by a `:`, then base64-encoded. Your Earthdata Client
password is stored as `EARTHDATA_CLIENT_PASSWORD` in `app/.env`.

This is pretty confusing, so an example should help. Let's say that we're using
this `.env` file:

**app/.env:**

```shell
EARTHDATA_CLIENT_ID=my-client-id
EARTHDATA_CLIENT_PASSWORD=my-client-password
```

In this case, `UrsId` would be just "my-client-id".

`UrsAuth` would be be the output of running:

```shell
$ echo -n 'my-client-id:my-client-password' | base64
bXktY2xpZW50LWlkOm15LWNsaWVudC1wYXNzd29yZA==
```

⚠️ **Warning:** You must include the `-n` in the `echo` command. If you don't,
it will add a newline to the end of the string, which will give you an incorrect
base64 hash.

### Permissions boundaries

For NASA NGAP users, When storing the secret in Secrets Manager, and when
performing a Terraform deployment, you _must_ be run using `NGAPShNonProd`
credentials.

### Outputs

In addition to adding the Thin Egress App module, it is useful to configure the
TEA outputs as outputs of your Terraform deployment. That would look something
like this:

```hcl
output "tea_api_endpoint" {
  value = module.thin_egress_app.api_endpoint
}

output "tea_urs_redirect_uri" {
  value = module.thin_egress_app.urs_redirect_uri
}
```

Once you've run the Terraform deployment, you should get an output something
like this:

```text
tea_api_endpoint = https://abc123.execute-api.us-east-1.amazonaws.com/DEV/
tea_urs_redirect_uri = https://abc123.execute-api.us-east-1.amazonaws.com/DEV/login
```

You will also need to configure the `tea_urs_redirect_uri` value as a Redirect
URI in your URS application configuration.

### Notes about Cumulus integration

The default Cumulus module generates a file at `s3://${system_bucket}/distribution_bucket_map.json`.

The configuration file is a simple json mapping of the form:

```json
{
  "daac-public-data-bucket": /path/to/this/kind/of/data
}
```

 **Please note: Cumulus only supports a one-to-one mapping of bucket->TEA path for 'distribution' buckets.**
