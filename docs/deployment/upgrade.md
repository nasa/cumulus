---
id: upgrade-readme
title: Upgrading Cumulus
hide_title: true
---

# Upgrading Cumulus

After the initial deployment, any future updates to the Cumulus deployment from configuration files, Terraform files (`*.tf`), or modules from a new version of Cumulus can be deployed and will update the appropriate portions of the stack as needed.

## Cumulus Versioning

Cumulus uses a global versioning approach, meaning version numbers are consistent across all packages and tasks, and semantic versioning to track major, minor, and patch version (e.g., 1.0.0). We use Lerna to manage versioning.

To view the released module artifacts for each Cumulus core version, see the [Cumulus Releases] page.

**IMPORTANT:** Cumulus releases may introduce breaking changes between minor versions (e.g., 1.13.x -> 1.14.0), so it is critical that you consult the release notes for migration steps.

## Migrating to a New Version

When breaking changes have been introduced, the Cumulus Core team will publish instructions on migrating from one version to another.  Detailed release notes with migration instructions (if any) for each release can be found on the [Cumulus Releases] page.

**IMPORTANT** 

1. **Use consistent Cumulus versions:** All modules must be updated to the same Cumulus version number (see below)
2. **Follow all intervening steps:** When skipping over versions, you **must perform all intervening migration steps**.  For example, if going from version 1.1.0 to 1.3.0, upgrade from 1.1.0 to 1.2.0 and then to 1.3.0.  This is critical because each release that contains migration steps provide instructions _only_ for migrating from the _immediately_ previous release, but you must follow _all_ migration steps between your currently installed release and _every release_ through the release that you wish to migrate to.
3. **Migrate lower environments first:** Migrate your "lowest" environment first and test it to ensure correctness before performing migration steps in each successively higher environment.  For example, in the EDCloud progress from a sandbox environment to UAT to SIT to PROD.
4. **Migrate during appropriate times:** Choose a time to migrate when support is more likely to be available in case you encounter problems, such as when you are most likely to quickly find help in the #cumulus-internal Slack channel.  Prefer earlier in the week over later in the week (particularly avoiding Fridays, if possible).

## Updating Cumulus Version

To update your Cumulus version:

1. Find the desired release on the [Cumulus Releases] page
2. Update the `source` in your Terraform deployment files **for each of [your Cumulus modules](./components.md#available-cumulus-components)** by replacing `vx.x.x` with the desired version of Cumulus.  For example, here's the
entry from the `data-persistence` module:

    `source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform.zip//tf-modules/data-persistence"`

3. Run `terraform init` to get the latest copies of your updated modules

## Update Data Persistence Resources

**Reminder:** Remember to [initialize Terraform](./README.md#initialize-terraform) if necessary.

From the directory of your `data-persistence` deployment module (e.g., `data-persistence-tf`):

```bash
$ AWS_REGION=<region> \ # e.g. us-east-1
    AWS_PROFILE=<profile> \
    terraform apply
```

## Update Cumulus Resources

**Reminder:** Remember [to initialize Terraform](./README.md#initialize-terraform) if necessary.

From the directory of your `cumulus` deployment module (e.g., `cumulus-tf`):

```bash
$ AWS_REGION=<region> \ # e.g. us-east-1
    AWS_PROFILE=<profile> \
    terraform apply
```

[Cumulus Releases]:
  https://github.com/nasa/cumulus/releases
