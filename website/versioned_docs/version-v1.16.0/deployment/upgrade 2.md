---
id: version-v1.16.0-upgrade-readme
title: Upgrading Cumulus
hide_title: true
original_id: upgrade-readme
---

# Upgrading Cumulus

After the initial deployment, any future updates to the Cumulus deployment from configuration files, Terraform files (`*.tf`), or modules from a new version of Cumulus can be deployed and will update the appropriate portions of the stack as needed.

## Cumulus versioning

Cumulus uses a global versioning approach, meaning version numbers are consistent across all packages and tasks, and semantic versioning to track major, minor, and patch version (i.e. 1.0.0). We use Lerna to manage versioning.

To view the released module artifacts for each Cumulus core version, see the [Cumulus releases page](https://github.com/nasa/cumulus/releases).

**IMPORTANT:** Cumulus releases may introduce breaking changes between minor versions (e.g. 1.13.x -> 1.14.0), so make sure to consult the release notes for migration steps.

## Migrating to a new version

When breaking changes have been introduced, the Cumulus Core team will publish instructions on migrating from one version to another.

Detailed release notes with migration instructions (if any) for each release can be found on the [Cumulus releases page](https://github.com/nasa/cumulus/releases).

**IMPORTANT:** When upgrading through many versions, each migration should be done in the order of release (if going from version 1.1.0 from 1.3.0, upgrade from 1.1.0 to 1.2.0 and then to 1.3.0).

## Updating Cumulus version

To update your Cumulus version:

1. Find the desired release on the [Cumulus releases page](https://github.com/nasa/cumulus/releases)
2. Update the `source` in your Terraform deployment files **for each of [your Cumulus modules](./components.md#available-cumulus-components)** by replacing `vx.x.x` with the desired version of Cumulus:

    `source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform.zip//tf-modules/data-persistence"`

3. Run `terraform init` to get the latest copies of your updated modules

## Update data persistence resources

**Reminder:** Remember [to initialize Terraform](./README.md#initialize-terraform) if necessary.

From the directory of your `data-persistence` deployment module (e.g. `data-persistence-tf`):

```bash
  $ AWS_REGION=<region> \ # e.g. us-east-1
      AWS_PROFILE=<profile> \
      terraform apply
```

## Update Cumulus resources

**Reminder:** Remember [to initialize Terraform](./README.md#initialize-terraform) if necessary.

From the directory of your `cumulus` deployment module (e.g. `cumulus-tf`):

```bash
  $ AWS_REGION=<region> \ # e.g. us-east-1
      AWS_PROFILE=<profile> \
      terraform apply
```
