# Cumulus Message Adapter

This package creates a Lambda layer for upload/use of the [Cumulus Message Adapter](https://github.com/nasa/cumulus-message-adapter). This layer can be utilized in combination with a Cumulus deployment per the [input/output Cumulus documentation](https://github.com/nasa/cumulus/docs/next/workflows/input_output).

## Deployment

1. Copy the .tfvars sample file: `cp terraform.tfvars.sample terraform.tfvars`
2. Populate the sample file with values that apply to your AWS environment (see configuration variables section below).
3. Ensure the terraform.tfstate file is not present if you've run this module previously.    As Terraform will remove previous versions of the layer rather than just adding a new layer, we've deliberately avoided constructing this module such that the resource will be updated.    If you run this module with a prior state, no update will occur.
4. Deploy this module: `terraform apply`

## Configuration

Configuration variables are shown in `terraform.tfvars.sample`, and are explained below:

```text
# Required
cma_version     = "v1.0.13" #  CMA Release version to deploy.
```
