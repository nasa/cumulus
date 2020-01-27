---
id: cmr_launchpad_authentication
title: CMR Launchpad Authentication
hide_title: true
---

# CMR Launchpad Authentication

Cumulus publishes granules to CMR.  CMR uses Earthdata Login system or Launchpad system for authentication. We can configure Cumulus to use one of the systems for CMR authentication.  This entry documents how we configure Cumulus to use Launchpad token for CMR authentication.

## Set up CMR Client

Steps for setting up the CMR Client to use Launchpad authentication can be found at [CMR Launchpad Authentication](https://wiki.earthdata.nasa.gov/display/CUMULUS/CMR+Launchpad+Authentication) wiki page.

## CUMULUS Configuration

1. Upload PKI certificate to S3:

    - Upload the PKI certificate `.pfx` file to S3
    - Use `system_bucket` as bucket name and `<prefix>/crypto/launchpad.pfx` as key
      - `system_bucket` and `prefix` are configured in `terraform.tfvars` for your [Cumulus deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module).
      - If a different private key file name other than `launchpad.pfx` is used, specify it in the `launchpad_certificate` configuration in `terraform.tfvars` for your Cumulus deployment.

2. Provide passphrase of PKI certificate in `terraform.tfvars` for your [Cumulus deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module)

    ```text
      launchpad_passphrase=LAUNCHPAD_PASSPHRASE
    ```

3. Configure your deployment variables for Launchpad integration in `terraform.tfvars` for your [Cumulus deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module).

    - `cmr_oauth_provider` in `terraform.tfvars` for your Cumulus deployment **must be set to `launchpad` to use Launchpad authentication**.
    - _Example configuration of other variables necessary for Launchpad integration can be found in Cumulus core's [example](https://github.com/nasa/cumulus/blob/master/example/deployments/sandbox.tfvars)_
