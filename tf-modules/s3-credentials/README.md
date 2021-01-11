# Cumulus - S3 credentials endpoint module

The Cumulus S3 credentials endpoint Terraform module deploys the S3
credentials endpoint with a configuration targeted at Cumulus and NGAP.

## Input variables

See [`variables.tf`]('./../variables.tf) for the input variables to this module.

## Output values

- **s3_credentials_redirect_uri** (string) - the redirect URL used by the S3
  credentials endpoint

## Example

```hcl
module "s3_credentials" {
  source = "https://github.com/nasa/cumulus/archive/terraform-aws-cumulus-s3-credentials-1.13.1.zip"

  prefix        = "my-prefix"

  permissions_boundary_arn = "arn:aws:iam::1234567890:policy/SomePermissionsBoundary"

  public_buckets    = ["public-1", "public-2"]

  sts_credentials_lambda_function_arn = "arn:aws:lambda:us-east-1:1234567890:function:sts-lambda"

  tea_api_gateway_stage = "stage-name"
  tea_external_api_endpoint = "https//example-tea-api.com"
  tea_rest_api_id = "XXXXXX"
  tea_rest_api_root_resource_id = "XXXXX"

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = "abc123"
  urs_client_password = "password"

  vpc_id     = "vpc-123"
  lambda_subnet_ids = ["subnet-123", "subnet-456"]
}
```
