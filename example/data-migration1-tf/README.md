# Data migration deployment module

## How to get value for `provider_kms_key_id` Terraform variable

```shell
  aws lambda get-function --function-name "<prefix>-ApiEndpoints" --query 'Configuration.Environment.Variables.provider_kms_key_id'
```
