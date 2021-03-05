# Cumulus - S3 credentials endpoint module

The Cumulus S3 credentials endpoint Terraform module deploys the S3
credentials endpoint with a configuration targeted at Cumulus and NGAP.

## Functionality

This module will add three endpoints to the REST API gateway identified by the input variables to this module:

- `/s3credentials` - Dispenses temporary [STS credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html) that can be used for in-region access of S3 data. Users must have a valid [Earthdata login](https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/earthdata-login) to get credentials from this endpoint.
- `/s3credentialsREADME` - Provides a "how to" guide for making requests to the `/s3credentials` endpoint
- `/redirect` - Handles the authentication redirect from Earthdata login
  - The full URL of this endpoint, including the domain for the API, must be added as an "allowed redirect" for the Earthdata login client application identified in the `urs_client_id` variable to this module

## Input variables

See [`variables.tf`](./variables.tf) for the input variables to this module.

## Output values

- **s3_credentials_redirect_uri** (string) - the redirect URL used by the S3
  credentials endpoint

## Example

```hcl
module "s3_credentials" {
  source = "https://github.com/nasa/cumulus/archive/terraform-aws-cumulus-s3-credentials-8.0.0.zip"

  prefix        = "my-prefix"

  permissions_boundary_arn = "arn:aws:iam::1234567890:policy/SomePermissionsBoundary"

  public_buckets    = ["public-1", "public-2"]

  sts_credentials_lambda_function_arn = "arn:aws:lambda:us-east-1:1234567890:function:sts-lambda"

  api_gateway_stage = "stage-name"
  external_api_endpoint = "https//example-tea-api.com"
  rest_api_id = "XXXXXX"
  rest_api_root_resource_id = "XXXXX"

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = "abc123"
  urs_client_password = "password"

  vpc_id     = "vpc-123"
  lambda_subnet_ids = ["subnet-123", "subnet-456"]
}
```
