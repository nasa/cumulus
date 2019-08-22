---
id: version-v1.14.0-cmr_launchpad_authentication
title: CMR Launchpad Authentication
hide_title: true
original_id: cmr_launchpad_authentication
---

# CMR Launchpad Authentication
Cumulus publishes granules to CMR.  CMR uses Earthdata Login system or Launchpad system for authentication. We can configure Cumulus to use one of the systems for CMR authentication.  This entry documents how we configure Cumulus to use Launchpad token for CMR authentication.

## Set up CMR Client

Steps for setting up the CMR Client to use Launchpad authentication can be found at [CMR Launchpad Authentication](https://wiki.earthdata.nasa.gov/display/CUMULUS/CMR+Launchpad+Authentication) wiki page.

## CUMULUS Configuration

1. Upload PKI certificate to s3

Upload the PKI certificate pfx file to s3, use `{{system_bucket}}` as bucket name and `{{prefix}}/crypto/launchpad.pfx` as key, `{{system_bucket}}` and `{{prefix}}` are configured in `app/config.yml`. If a different private key file name other than `launchpad.pfx` is used, specify it in the `launchpad` configuration in `app/config.yml`.

2. Provide passphrase of PKI certificate in `app/.env`

LAUNCHPAD_PASSPHRASE=<LAUNCHPAD_PASSPHRASE>

3. Configure the `launchpad` configuration parameters in `app/config.yml`. _Example configuration of the `launchpad` can be found in Cumulus core's [example](https://github.com/nasa/cumulus/blob/master/example/app/config.yml)_

`cmr.oauthProvider` in `app/config.yml` must be set to `launchpad` to use Launchpad authentication.