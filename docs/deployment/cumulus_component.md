---
id: cumulus_component
title: Cumulus Terraform Module
hide_title: true
---

# Cumulus Terraform Module

The Cumulus Terraform module packages together a number of commonly-used components for ease of deployment.

## Input variables

### Required

* **prefix** (string) - Resource prefix unique to this deployment
* **subnet_ids** (list(string)) - VPC subnets used by Lambda functions
* **system_bucket** (string) - A bucket to be used for staging deployment files
* **urs_client_id** (string) - The URS app ID
* **urs_client_password** (string) - The URS app password
* **vpc_id** (string) - VPC used by Lambda functions

### Optional

* **distribution_url** (string) - An alternative URL used for distribution"
* **permissions_boundary_arn** (string) - The ARN of an IAM permissions boundary
  to use when creating IAM policies"
* **protected_buckets** (list(string)) - A list of protected buckets"
* **public_buckets** (list(string)) - A list of public buckets"
* **region** (string) - The AWS region to deploy to, defaults to "us-east-1"
* **thin_egress_app_deployment_stage** (string) - The API Gateway stage to
  create, defaults to "DEV"
* **urs_url** (string) - The URL of the Earthdata Login site, defaults to
  "https://urs.earthdata.nasa.gov"

## Output variables

* **distribution_url** (string) - the URL of the distribution API
* **thin_egress_app_redirect_uri** (string) - the redirect URL used by the Thin
  Egress App
* **s3_credentials_redirect_uri** (string) - the redirect URL used by the S3
  credentials endpoint
