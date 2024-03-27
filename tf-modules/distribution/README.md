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

- **api_gateway_stage** (string) - The API Gateway stage to create, defaults to `DEV`
- **cmr_provider** (string) - The provider used to search CMR ACLs, defaults to `null`
- **deploy_s3_credentials_endpoint** - (bool) Option to deploy the s3 credentials endpoint, defaults to `true`
- **distribution_url** (string) - An alternative URL (e.g. CloudFront URL) used for distribution
- **permissions_boundary_arn** (string) - The ARN of an IAM permissions boundary to use when creating IAM policies
- **protected_buckets** (list(string)) - A list of protected buckets
- **public_buckets** (list(string)) - A list of public buckets
- **region** (string) - The AWS region to deploy to, defaults to "us-east-1"
- **sts_credentials_lambda_function_arn** (string) - The ARN of the Lambda
  function for the S3 credentials endpoint to invoke, which will return AWS API
  keys. This value is required if deploying the s3credentials endpoint.
- **sts_policy_helper_lambda_function_arn** (string) - The ARN of the Lambda
  function that outputs session policies to be passed to the
  `sts_credentials_lambda`.
- **tea_api_egress_log_group** (string) - Name of the Cloudwatch log group for the Thin Egress App (TEA) Lambda
- **tea_api_gateway_stage** (string) - Name of the API gateway stage for Thin Egress App (TEA)
- **tea_internal_api_endpoint** (string) - URL for the Thin Egress App (TEA) API gateway
- **tea_rest_api_id** (string) - API Gateway ID for the Thin Egress App (TEA)
- **tea_rest_api_root_resource_id** (string) - Root resource ID for the Thin Egress App (TEA) API gateway
- **tags** (list(string)) - AWS tags to be assigned to resources managed by this
  module
- **urs_url** (string) - The URL of the Earthdata Login site, defaults to
  <https://urs.earthdata.nasa.gov>
- **cmr_acl_based_credentials** (bool) - Option to enable/disable user specific
  CMR ACLs to derive permission for S3 access credentials, defaults to
  `false`. When `true`, the `s3credentials` endpoint will use the decoded JWT
  username to request from CMR a list of permitted buckets/paths before using NGAPs
  sts policy helper lambda, to generate the permissions attatched to the
  returned credentials.

## Output variables

- **distribution_bucket_map** (object) - the contents of the distribution bucket map
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

  deploy_s3_credentials_endpoint = true
  cmr_provider                   = "CUMULUS"
  cmr_acl_based_credentials      = true

  vpc_id     = "vpc-123"
  subnet_ids = ["subnet-123", "subnet-456"]
}
```
