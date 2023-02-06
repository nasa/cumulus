---
id: version-v1.14.2-cumulus_api_launchpad_authentication
title: Cumulus API Launchpad Authentication
hide_title: true
original_id: cumulus_api_launchpad_authentication
---

# Cumulus API Launchpad Authentication
Cumulus API supports Launchpad as an authentication option. That is, authentication by bringing your own Launchpad token returned from the [NASA Launchpad](https://www.nasa.gov/offices/ocio/launchpad_faq.html) `/gettoken` endpoint.

## Set up the Cumulus API Launchpad Client

Steps for setting up the Cumulus API to use Launchpad authentication can be found at [Cumulus API Launchpad Authentication](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cumulus+API+with+Launchpad+Authentication) wiki page.  Following these steps will allow your client to retrieve a Launchpad sm_token that can be provided to Cumulus API endpoints for authentication.


## Cumulus Configuration

1. Upload PKI certificate to s3

Upload the PKI certificate pfx file to s3, use `{{system_bucket}}` as bucket name and `{{prefix}}/crypto/launchpad.pfx` as key, `{{system_bucket}}` and `{{prefix}}` are configured in `app/config.yml`. If a different private key file name other than `launchpad.pfx` is used, specify it in the `launchpad` configuration in `app/config.yml`.

2. Provide passphrase of PKI certificate in `app/.env`

LAUNCHPAD_PASSPHRASE=<LAUNCHPAD_PASSPHRASE>

3. Configure the `oauth.provider` and `oauth.userGroup` configuration parameters in `app/config.yml`. _Example configuration of the `oauth` variables can be found in Cumulus core's [example](https://github.com/nasa/cumulus/blob/master/example/app/config.yml)_

`oauth.provider` in `app/config.yml` must be set to `launchpad` to use Launchpad authentication.
