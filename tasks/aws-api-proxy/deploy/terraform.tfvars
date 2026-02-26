# This tfvars file contains non-sensitive customization that's specific to this task
# Additional variables are specified at deploy-time as environment variables:
# export TF_VAR_prefix=<your_prefix_here>
# export TF_VAR_lambda_processing_role_pattern="^my-prefix-.*lambda-processing.*$"
# Optionally, you can also specify tags to apply to resources created by this task:
# export TF_VAR_tags='{"tag_key": "tag_value"}'
lambda_timeout = 60 * 15
lambda_memory_size = 4096
