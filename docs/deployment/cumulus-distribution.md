---
id: cumulus_distribution
title: Using the Cumulus Distribution API
hide_title: false
---

The Cumulus Distribution API is a set of endpoints that can be used to enable AWS Cognito authentication when downloading data from S3.

## Configuring a Cumulus Distribution deployment

The Cumulus Distribution API is included in the main [Cumulus](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus_distribution) repo.

To configure a deployment to use Cumulus Distribution, remove or comment the "Thin Egress App Settings" in [the Cumulus Template Deploy](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/main.tf) and enable the Cognito settings.

No additional configuration is necessary to deploy the Cumulus Distribution API.