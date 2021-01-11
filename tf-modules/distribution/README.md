# Cumulus Distribution Terraform Module

The Cumulus Distribution Terraform module deploys resources needed for interacting with the Thin Egress App.

## Input variables

### Required

- **deploy_to_ngap** (boolean) - `true` if deployment is going to an NGAP account
- **prefix** (string) - Resource prefix unique to this deployment
- **system_bucket** (string) - A bucket to be used for staging deployment files
- **tea_internal_api_endpoint** (string) - URL for the Thin Egress App (TEA) API gateway

### Optional

- **lambda_subnet_ids** (list(string)) - VPC subnets used by Lambda functions
- **permissions_boundary_arn** (string) - The ARN of an IAM permissions boundary
  to use when creating IAM policies
- **protected_buckets** (list(string)) - A list of protected buckets
- **public_buckets** (list(string)) - A list of public buckets
- **tags** (list(string)) - AWS tags to be assigned to resources managed by this
  module
- **urs_url** (string) - The URL of the Earthdata Login site, defaults to
  <https://urs.earthdata.nasa.gov>
- **vpc_id** (string) - VPC used by Lambda functions

## Output variables

- **distribution_bucket_map** (object) - the contents of the distribution bucket map

## Example

```hcl
module "distribution" {
  source = "https://github.com/nasa/cumulus/archive/terraform-aws-cumulus-distribution-1.13.1.zip"

  deploy_to_ngap = true

  prefix        = "my-prefix"
  system_bucket = "my-internal-bucket"

  lambda_processing_role_arn = "arn:aws:iam::1234567890:role/lambda-processing"

  permissions_boundary_arn = "arn:aws:iam::1234567890:policy/SomePermissionsBoundary"

  protected_buckets = ["protected-1", "protected-2"]
  public_buckets    = ["public-1", "public-2"]

  tea_internal_api_endpoint = "https://abc123.execute-api.us-east-1.amazonaws.com/dev"

  urs_url             = "https://uat.urs.earthdata.nasa.gov"
  urs_client_id       = "abc123"
  urs_client_password = "password"

  vpc_id     = "vpc-123"
  lambda_subnet_ids = ["subnet-123", "subnet-456"]
}
```
