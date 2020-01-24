# Cumulus Distribution Terraform Module

The Cumulus Distribution Terraform module deploys the Thin Egress App and the S3
Credentials Endpoint with a configuration targeted at Cumulus and NGAP.

## Input variables

### Required

- **prefix** (string) - Resource prefix unique to this deployment
- **subnet_ids** (list(string)) - VPC subnets used by Lambda functions
- **system_bucket** (string) - A bucket to be used for staging deployment files
- **urs_client_id** (string) - The URS app ID
- **urs_client_password** (string) - The URS app password
- **vpc_id** (string) - VPC used by Lambda functions

### Optional

- **api_gateway_stage** (string) - The API Gateway stage to create, defaults to
  "DEV"
- **distribution_url** (string) - An alternative URL used for distribution
- **permissions_boundary_arn** (string) - The ARN of an IAM permissions boundary
  to use when creating IAM policies
- **protected_buckets** (list(string)) - A list of protected buckets
- **public_buckets** (list(string)) - A list of public buckets
- **region** (string) - The AWS region to deploy to, defaults to "us-east-1"
- **sts_credentials_lambda_function_arn** (string) - The ARN of the Lambda
  function for the S3 credentials endpoint to invoke, which whill return AWS API
  keys.
- **urs_url** (string) - The URL of the Earthdata Login site, defaults to
  <https://urs.earthdata.nasa.gov>

## Output variables

- **distribution_url** (string) - the URL of the distribution API
- **thin_egress_app_redirect_uri** (string) - the redirect URL used by the Thin
  Egress App
- **s3_credentials_redirect_uri** (string) - the redirect URL used by the S3
  credentials endpoint

## Example

```hcl
module "distribution" {
  source = "https://github.com/nasa/cumulus/archive/terraform-aws-cumulus-distribution-1.13.1.zip"

  prefix        = "my-prefix"
  system_bucket = "my-internal-bucket"

  permissions_boundary_arn = "arn:aws:iam::1234567890:policy/SomePermissionsBoundary"

  protected_buckets = ["protected-1", "protected-2"]
  public_buckets    = ["public-1", "public-2"]

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = "abc123"
  urs_client_password = "password"

  vpc_id     = "vpc-123"
  subnet_ids = ["subnet-123", "subnet-456"]
}
```
