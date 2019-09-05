# Report PDRs

This package includes a Lambda function to process PDR ingest notifications received via SNS and store PDR data to a database.

## Deployment

1. Copy the .tfvars sample file: `cp terraform.tfvars.sample terraform.tfvars`
2. Populate the sample file with values that apply to your AWS environment (see configuration variables section below).
3. Deploy this module: `terraform apply`

## Configuration

Configuration variables are shown in `terraform.tfvars.sample`, and are explained below:

```text
# Required
pdrs_table            = "PdrsTableName"  # name of DynamoDB table to store PDRs data
prefix                = "myprefix" # prefix to use for naming created resources

# Optional
permissions_boundary  = "arn:aws:iam::1234567890:policy/YourRoleBoundary" # IAM permissions boundary
security_groups       = ["sg-123456"]          # Security Group IDs (for Lambda)
subnet_ids            = ["subnet-123456"]      # Subnet IDs (for Lambda)
```
