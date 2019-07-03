# S3 Replicator

This package includes a simple lambda functions and associated permissions to replicate create-object events from one S3 bucket to another.
It was developed to enable same-region cross-account object replication.

## Configuration

Configuration variables are shown in `cfg.tfvars.sample`, and are explained below:

```
prefix               = "myprefix"             # prefix to name created replicator resources
aws_profile          = "ngap"                 # AWS profile used for deployment
permissions_boundary = "NGAPShRoleBoundary"   # IAM permissions boundary
vpc_id               = "vpc-123456"           # VPC ID (for Lambda)
subnet_ids           = ["subnet-123456"]      # Subnet IDs (for Lambda)
security_groups      = ["sg-123456"]          # Security Group IDs (for Lambda)
source_bucket        = "source-bucket-name"   # Source S3 bucket
source_prefix        = "source-prefix"        # Source object prefix e.g. 'path/to/filedir'
target_bucket        = "target-bucket-name"   # Target S3 bucket e.g. 'mybucket'
target_prefix        = "target-prefix"        # Target object prefix path
```
