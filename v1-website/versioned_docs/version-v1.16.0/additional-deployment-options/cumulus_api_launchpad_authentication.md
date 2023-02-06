---
id: version-v1.16.0-cumulus_api_launchpad_authentication
title: Cumulus API Launchpad Authentication
hide_title: true
original_id: cumulus_api_launchpad_authentication
---

# Cumulus API Launchpad Authentication

Cumulus API supports Launchpad as an authentication option. That is, authentication by bringing your own Launchpad token returned from the [NASA Launchpad](https://www.nasa.gov/offices/ocio/launchpad_faq.html) `/gettoken` endpoint.

## Set up the Cumulus API Launchpad Client

Steps for setting up the Cumulus API to use Launchpad authentication can be found at [Cumulus API Launchpad Authentication](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cumulus+API+with+Launchpad+Authentication) wiki page.  Following these steps will allow your client to retrieve a Launchpad sm_token that can be provided to Cumulus API endpoints for authentication.

## Cumulus Configuration

1. Upload PKI certificate to S3:

    - Upload the PKI certificate `.pfx` file to S3
    - Use `system_bucket` as bucket name and `<prefix>/crypto/launchpad.pfx` as key
      - `system_bucket` and `prefix` are configured in `terraform.tfvars` for your [Cumulus deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module).
      - If a different private key file name other than `launchpad.pfx` is used, specify it in the `launchpad_certificate` configuration in `terraform.tfvars`.

2. Provide passphrase of PKI certificate in `terraform.tfvars` for your [Cumulus deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module)

    ```text
      launchpad_passphrase=LAUNCHPAD_PASSPHRASE
    ```

3. Configure the `oauth_provider` and `oauth_user_group` configuration parameters in `terraform.tfvars` for your [Cumulus deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module)

   - `oauth_provider` in `terraform.tfvars` **must be set to `launchpad` to use Launchpad authentication**.
   - _Example configuration of the `oauth_user_group` variable and other variables necessary for Launchpad integration can be found in Cumulus core's [example](https://github.com/nasa/cumulus/blob/master/example/deployment/sandbox.tfvars)_
