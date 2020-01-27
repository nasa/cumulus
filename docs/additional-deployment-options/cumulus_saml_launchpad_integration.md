---
id: cumulus_saml_launchpad_integration
title: Cumulus SAML Launchpad Integration
hide_title: true
---

# Cumulus SAML Launchpad Integration

Cumulus supports authenticating users through Launchpad SAML Integration.  

## Set up the Cumulus API Launchpad Client

The steps for setting up Cumulus API and Cumulus Dashboard to use Launchpad SAML integration can be found at [Cumulus SAML Launchpad Integration](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cumulus+SAML+Launchpad+Integration) wiki page.

## Cumulus Configuration

Configure the `oauth_*` and `saml_*` configuration variables in `terraform.tfvars` for your [Cumulus deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module)

- `oauth_provider` in `terraform.tfvars` **must be set to `launchpad` to use Launchpad authentication**.
- _Example configuration of the `oauth_user_group` variable and other variables necessary for Launchpad integration can be found in Cumulus core's [example](https://github.com/nasa/cumulus/blob/master/example/deployments/sandbox.tfvars)_
