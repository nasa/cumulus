# Publish notifications

This package includes a Lambda function to publish ingest notifications for granule data, execution data, and PDR data to respective SNS topics

## Deployment

1. Copy the .tfvars sample file: `cp terraform.tfvars.sample terraform.tfvars`
2. Populate the sample file with values that apply to your AWS environment (see configuration variables section below).
3. Deploy this module: `terraform apply`

NOTE: Terraform will ignore the `aws_profile` config variable if you have static credentials or environment variables set, see the [AWS Provider page](https://www.terraform.io/docs/providers/aws/index.html#authentication).

## Configuration

Configuration variables are shown in `terraform.tfvars.sample`, and are explained below:

```text
# Required
prefix                     = "myprefix" # prefix to use for naming created resources
execution_sns_topic_arn    = "arn:aws:sns::1234567890:executionsTopicName" # topic for publishing execution data
granule_sns_topic_arn      = "arn:aws:sns::1234567890:granulesTopicName" # topic for publishing granule data
pdr_sns_topic_arn          = "arn:aws:sns::1234567890:pdrTopicName" # topic for publishing PDR data
state_machine_arns         = [
  "arn:aws:states:us-east-1:1234567890:stateMachine:stateMachineName"
]

# Optional
permissions_boundary  = "arn:aws:iam::1234567890:policy/YourRoleBoundary" # IAM permissions boundary
security_groups       = ["sg-123456"]          # Security Group IDs (for Lambda)
subnet_ids            = ["subnet-123456"]      # Subnet IDs (for Lambda)
```
