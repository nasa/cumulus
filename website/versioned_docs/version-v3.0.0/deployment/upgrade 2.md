---
id: version-v3.0.0-upgrade-readme
title: Upgrading Cumulus
hide_title: false
original_id: upgrade-readme
---

After the initial deployment, any future updates to the Cumulus deployment from configuration files, Terraform files (`*.tf`), or modules from a new version of Cumulus can be deployed and will update the appropriate portions of the stack as needed.

## Cumulus versioning

Cumulus uses a global versioning approach, meaning version numbers are consistent across all Terraform modules, and semantic versioning to track major, minor, and patch version (e.g., 1.0.0).

**IMPORTANT:** By convention, Cumulus minor version releases introduce breaking changes (e.g., 1.13.x -> 1.14.0), so it is critical that you consult the release notes for migration steps.  Carefully read each BREAKING CHANGES and MIGRATION STEPS sections within the `CHANGELOG.md` file, following all steps, starting with the oldest release after your currently installed release, and progressing through them chronologically.

To view the released module artifacts for each Cumulus core version, see the [Cumulus Releases] page.

## Migrating to a new version

When breaking changes have been introduced, the Cumulus Core team will publish instructions on migrating from one version to another.  Detailed release notes with migration instructions (if any) for each release can be found on the [Cumulus Releases] page.

1. **Use consistent Cumulus versions:** All Terraform modules must be updated to the same Cumulus version number (see below). In addition, your workflow lambdas that utilize published Cumulus Core npm modules should always match your deployed Cumulus version to ensure compatibility. **Check the CHANGELOG for deprecation/breaking change notices.**
2. **Follow all intervening steps:** When skipping over versions, you **must perform all intervening migration steps**.  For example, if going from version 1.1.0 to 1.3.0, upgrade from 1.1.0 to 1.2.0 and then to 1.3.0.  This is critical because each release that contains migration steps provide instructions _only_ for migrating from the _immediately_ previous release, but you must follow _all_ migration steps between your currently installed release and _every release_ through the release that you wish to migrate to.
3. **Migrate lower environments first:** Migrate your "lowest" environment first and test it to ensure correctness before performing migration steps in each successively higher environment.  For example, update Sandbox, then UAT, then SIT, and finally Prod.
4. **Conduct smoke tests:** In each environment, perform smoke tests that give you confidence that the upgrade was successful, prior to moving on to the next environment. Since deployments can vary widely, it is up to you to determine tests that might be specific to your deployment, but here are some general tests you might wish to perform:
    * Confirm the Cumulus API is running and reachable by hitting the `/version` endpoint
    * Run a workflow and confirm its operation (taking care in Production)
    * Confirm distribution works
5. **Migrate during appropriate times:** Choose a time to migrate when support is more likely to be available in case you encounter problems, such as when you are most likely to be able to obtain support relatively promptly.  Prefer earlier in the week over later in the week (particularly avoiding Fridays, if possible).

## Updating Cumulus version

To update your Cumulus version:

1. Find the desired release on the [Cumulus Releases] page
2. Update the `source` in your Terraform deployment files **for each of [your Cumulus modules](./components.md#available-cumulus-components)** by replacing `vx.x.x` with the desired version of Cumulus.  For example, here's the
entry from the `data-persistence` module:

    `source = "https://github.com/nasa/cumulus/releases/download/vx.x.x/terraform.zip//tf-modules/data-persistence"`

3. Run `terraform init` to get the latest copies of your updated modules

## Update data persistence resources

**Reminder:** Remember to [initialize Terraform](./README.md#initialize-terraform) if necessary.

From the directory of your `data-persistence` deployment module (e.g., `data-persistence-tf`):

```bash
$ AWS_REGION=<region> \ # e.g. us-east-1
    AWS_PROFILE=<profile> \
    terraform apply
```

## Update Cumulus resources

**Reminder:** Remember [to initialize Terraform](./README.md#initialize-terraform) if necessary.

From the directory of your `cumulus` deployment module (e.g., `cumulus-tf`):

```bash
$ AWS_REGION=<region> \ # e.g. us-east-1
    AWS_PROFILE=<profile> \
    terraform apply
```

Once you have successfully updated all of your resources, verify that your
deployment functions correctly. Please refer to some recommended smoke tests
given above, and consider additional tests appropriate for your particular
deployment and environment.

## Update Cumulus Dashboard

If there are breaking (or otherwise significant) changes to the Cumulus API, you should also upgrade your Cumulus Dashboard deployment to use the version of the Cumulus API matching the version of Cumulus to which you are migrating.

[Cumulus Releases]:
  https://github.com/nasa/cumulus/releases
