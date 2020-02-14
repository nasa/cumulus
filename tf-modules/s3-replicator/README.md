# S3 Replicator

This package includes a simple lambda functions and associated permissions to replicate create-object events from one S3 bucket to another.
It was developed to enable same-region cross-account object replication.

## Deployment

Copy the .tfvars sample file:

```bash
cp terraform.tfvars.sample terraform.tfvars
```

Populate the sample file with values that apply to your AWS environment (see configuration variables section, below).

Deploy this module with:

```bash
terraform apply
```

NOTE: Terraform will ignore the `aws_profile` config variable if you have static credentials or environment variables set, see the [AWS Provider page](https://www.terraform.io/docs/providers/aws/index.html#authentication).

## Configuration

Configuration variables are shown in `terraform.tfvars.sample`, and are explained below:

```bash
prefix               = "myprefix"                                         # prefix to name created replicator resources
permissions_boundary = "arn:aws:iam::1234567890:policy/YourRoleBoundary"  # IAM permissions boundary ARN
source_bucket        = "source-bucket-name"                               # Source S3 bucket
source_prefix        = "source-prefix"                                    # Source object prefix e.g. 'path/to/filedir'
tags                 = { Deployment = "myprefix" }                        # Tags to be assigned to all managed resources
target_bucket        = "target-bucket-name"                               # Target S3 bucket e.g. 'mybucket'
target_prefix        = "target-prefix"                                    # Target object prefix path

# Optional
security_group_ids   = ["sg-123456"]                                      # Security Group IDs (for Lambda)
vpc_id               = "vpc-123456"                                       # VPC ID (for Lambda)
subnet_ids           = ["subnet-123456"]                                  # Subnet IDs (for Lambda)
```
