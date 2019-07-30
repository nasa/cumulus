# Report Executions

This package includes a Lambda function to process workflow execution information received via SNS and store it to a database.

## Deployment

1. Copy the .tfvars sample file: `cp cfg.tfvars.sample cfg.tfvars`
2. Populate the sample file with values that apply to your AWS environment (see configuration variables section below).
3. Deploy this module: `terraform apply -var-file=cfg.tfvars`

NOTE: Terraform will ignore the `aws_profile` config variable if you have static credentials or environment variables set, see the [AWS Provider page](https://www.terraform.io/docs/providers/aws/index.html#authentication).

## Configuration

Configuration variables are shown in `cfg.tfvars.sample`, and are explained below:

```text
prefix               = "myprefix"             # prefix to name created resources
aws_profile          = "ngap"                 # AWS profile used for deployment
permissions_boundary = "NGAPShRoleBoundaryArn" # IAM permissions boundary
vpc_id               = "vpc-123456"           # VPC ID (for Lambda)
subnet_ids           = ["subnet-123456"]      # Subnet IDs (for Lambda)
security_groups      = ["sg-123456"]          # Security Group IDs (for Lambda)
```
