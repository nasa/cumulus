---
id: release
---
# Versioning and Releases

## Versioning

We use a global versioning approach, meaning version numbers in cumulus are consistent across all packages and tasks, and semantic versioning to track major, minor, and patch version (i.e. 1.0.0). We use Lerna to manage our versioning. Any change will force lerna to increment the version of all packages.

Read more about the semantic versioning [here](https://docs.npmjs.com/getting-started/semantic-versioning).

## Pre-release testing

:::note

This is only necessary when preparing a release for a new major version of Cumulus (e.g. preparing to go from `6.x.x` to `7.0.0`).

:::

Before releasing a new major version of Cumulus, we should test the deployment upgrade path from the latest release of Cumulus to the upcoming release.

It is preferable to use the [cumulus-template-deploy](https://github.com/nasa/cumulus-template-deploy) repo for testing the deployment, since that repo is the officially recommended deployment configuration for end users.

You should create an entirely new deployment for this testing to replicate the end user upgrade path. Using an existing test or CI deployment would not be useful because that deployment may already have been deployed with the latest changes and not match the upgrade path for end users.

Pre-release testing steps:

1. Checkout the [cumulus-template-deploy](https://github.com/nasa/cumulus-template-deploy) repo
2. Update the deployment code to use the latest release artifacts if it wasn't done already. For example, assuming that the latest release was `5.0.1`, update the deployment files as follows:

    ```text
    # in data-persistence-tf/main.tf
    source = "https://github.com/nasa/cumulus/releases/download/v5.0.1/terraform-aws-cumulus.zip//tf-modules/data-persistence"

    # in cumulus-tf/main.tf
    source = "https://github.com/nasa/cumulus/releases/download/v5.0.1/terraform-aws-cumulus.zip//tf-modules/cumulus"
    ```

3. For both the `data-persistence-tf` and `cumulus-tf` modules:
   1. Add the necessary backend configuration (`terraform.tf`) and variables (`terraform.tfvars`)
      - You should use an entirely new deployment for this testing, so make sure to use values for `key` in `terraform.tf` and `prefix` in `terraform.tfvars` that don't collide with existing deployments
   2. Run `terraform init`
   3. Run `terraform apply`
4. Checkout the `master` branch of the `cumulus` repo
5. Run a full bootstrap of the code: `npm run bootstrap`
6. Build the pre-release artifacts: `./bamboo/create-release-artifacts.sh`
7. For both the `data-persistence-tf` and `cumulus-tf` modules:
   1. Update the deployment to use the built release artifacts:

      ```text
      # in data-persistence-tf/main.tf
      source = "[path]/cumulus/terraform-aws-cumulus.zip//tf-modules/data-persistence"

      # in cumulus-tf/main.tf
      source = "/Users/mboyd/development/cumulus/terraform-aws-cumulus.zip//tf-modules/cumulus"
      ```

   2. Review the `CHANGELOG.md` for any pre-deployment migration steps. If there are, go through the steps and confirm that they are successful
   3. Run `terraform init`
   4. Run `terraform apply`
8. Review the `CHANGELOG.md` for any post-deployment migration steps and confirm that they are successful
9. Delete your test deployment by running `terraform destroy` in `cumulus-tf` and `data-persistence-tf`

## Updating Cumulus version and publishing to NPM

### Deployment Steps

1. [Create a branch for the new release](#1-create-a-branch-for-the-new-release)
2. [Update the Cumulus version number](#2-update-the-cumulus-version-number)
3. [Check Cumulus Dashboard PRs for Version Bump](#3-check-cumulus-dashboard-prs-for-version-bump)
4. [Update CHANGELOG.md](#4-update-changelogmd)
5. [Update DATA\_MODEL\_CHANGELOG.md](#5-update-data_model_changelogmd)
6. [Update CONTRIBUTORS.md](#6-update-contributorsmd)
7. [Update Cumulus package API documentation](#7-update-cumulus-package-api-documentation)
8. [Cut new version of Cumulus Documentation](#8-cut-new-version-of-cumulus-documentation)
9. [Create a pull request against the minor version branch](#9-create-a-pull-request-against-the-minor-version-branch)
10. [Create a git tag for the release](#10-create-a-git-tag-for-the-release)
11. [Publishing the release](#11-publishing-the-release)
12. [Create a new Cumulus release on github](#12-create-a-new-cumulus-release-on-github)
13. [Update Cumulus API document](#13-update-cumulus-api-document)
14. [Update Cumulus Template Deploy](#14-update-cumulus-template-deploy)
15. [Merge base branch back to master](#15-merge-base-branch-back-to-master)

### 1. Create a branch for the new release

#### From Master

Create a branch titled `release-MAJOR.MINOR.x` for the release (use a literal x for the patch version).

```shell
    git checkout -b release-MAJOR.MINOR.x

e.g.:
    git checkout -b release-9.1.x
```

If creating a new major version release from master, say `5.0.0`, then the branch would be named `release-5.0.x`. If creating a new minor version release from master, say `1.14.0` then the branch would be named `release-1.14.x`.

Having a release branch for each major/minor version allows us to easily backport patches to that version.

Push the `release-MAJOR.MINOR.x` branch to GitHub if it was created locally. (Commits should be even with master at this point.)

If creating a patch release, you can check out the existing base branch.

Then create the release branch (e.g. `release-1.14.0`) from the minor version base branch. For example, from the `release-1.14.x` branch:

```bash
git checkout -b release-1.14.0
```

#### Backporting

When creating a backport, a minor version base branch should already exist on GitHub. Check out the existing minor version base branch then create a release branch from it. For example:

```bash
# check out existing minor version base branch
git checkout release-1.14.x
# pull to ensure you have the latest changes
git pull origin release-1.14.x
# create new release branch for backport
git checkout -b release-1.14.1
# cherry pick the commits (or single squashed commit of changes) relevant to the backport
git cherry-pick [replace-with-commit-SHA]
# push up the changes to the release branch
git push
```

### 2. Update the Cumulus version number

When changes are ready to be released, the Cumulus version number must be updated.

Lerna handles the process of deciding which version number should be used as long as the developer specifies whether the change is a major, minor, or patch change.

To update Cumulus's version number run:

```bash
npm run update
```

![Screenshot of terminal showing interactive prompt from Lerna for selecting the new release version](https://static.notion-static.com/13acbe0a-c59d-4c42-90eb-23d4ec65c9db/Screen_Shot_2018-03-15_at_12.21.16_PM.png)

Lerna will handle updating the packages and all of the dependent package version numbers. If a dependency has not been changed with the update, however, lerna will not update the version of the dependency.

#### 2B. Verify Lerna

:::note

Lerna can struggle to correctly update the versions on any non-standard/alpha versions (e.g. `1.17.0-alpha0`). Additionally some packages may have been left at the previous version.
Please be sure to check any packages that are new or have been manually published since the previous release and any packages that list it as a dependency to ensure the listed versions are correct.
It's useful to use the search feature of your code editor or `grep` to see if there any references to the **_old_** package versions.
In bash shell you can run

:::

```bash
    find . -name package.json -exec grep -nH "@cumulus/.*[0-9]*\.[0-9]\.[0-9].*" {} \; | grep -v "@cumulus/.*MAJOR\.MINOR\.PATCH.*"

e.g.:
    find . -name package.json -exec grep -nH "@cumulus/.*[0-9]*\.[0-9]\.[0-9].*" {} \; | grep -v "@cumulus/.*13\.1\.0.*"
```

Verify that no results are returned where MAJOR, MINOR, or PATCH differ from the intended version, and no outdated `-alpha` or `-beta` versions are specified.

### 3. Check Cumulus Dashboard PRs for Version Bump

There may be unreleased changes in the Cumulus Dashboard [project](https://github.com/nasa/cumulus-dashboard) that rely on this unreleased Cumulus Core version.

If there is exists a PR in the cumulus-dashboard repo with a name containing: "Version Bump for Next Cumulus API Release":

- There will be a placeholder `change-me` value that should be replaced with the Cumulus Core to-be-released-version.
- Mark that PR as ready to be reviewed.

### 4. Update CHANGELOG.md

Update the `CHANGELOG.md`. Put a header under the `Unreleased` section with the new version number and the date.

Add a link reference for the github "compare" view at the bottom of the `CHANGELOG.md`, following the existing pattern. This link reference should create a link in the CHANGELOG's release header to changes in the corresponding release.

### 5. Update DATA\_MODEL\_CHANGELOG.md

Similar to #4, make sure the DATA\_MODEL\_CHANGELOG is updated if there are data model changes in the release, and the link reference at the end of the document is updated as appropriate.

### 6. Update CONTRIBUTORS.md

```bash
./bin/update-contributors.sh
git add CONTRIBUTORS.md
```

Commit and push these changes, if any.

### 7. Update Cumulus package API documentation

Update auto-generated API documentation for any Cumulus packages that have it:

```bash
npm run docs-build-packages
```

Commit and push these changes, if any.

### 8. Cut new version of Cumulus Documentation

Docusaurus v2 uses snapshot approach for [documentation versioning](https://docusaurus.io/docs/versioning). Every versioned docs
does not depends on other version.
If this is a patch version, or a minor version with no significant functionality changes requiring document update, do not create
a new version of the documentation, update the existing versioned_docs document instead.

Create a new version:

```bash
cd website
npm run docusaurus docs:version ${release_version}
# please update version in package.json
git add .
```

Instructions to rename an existing version:

```bash
cd website
git mv versioned_docs/version-<oldversion> versioned_docs/version-${release_version}
git mv versioned_sidebars/version-<oldversion>-sidebars.json versioned_sidebars/version-${release_version}-sidebars.json
# please update versions.json with new version
# please update documents under versioned_docs/version-${release_version}
git add .
```

Where `${release_version}` corresponds to the version tag `v1.2.3`, for example.

Commit and push these changes.

### 9. Create a pull request against the minor version branch

1. Push the release branch (e.g. `release-1.2.3`) to GitHub.
2. Create a PR against the minor version base branch (e.g. `release-1.2.x`).
3. Configure Bamboo to run automated tests against this PR by finding the branch plan for the release branch (`release-1.2.3`) and setting only these variables:

    - `GIT_PR`: `true`
    - `SKIP_AUDIT`: `true`

    :::warning important

    Do NOT set the `PUBLISH_FLAG` variable to `true` for this branch plan. The actual publishing of the release will be handled by a separate, manually triggered branch plan.

    :::

    ![Screenshot of Bamboo CI interface showing the configuration of the GIT_PR branch variable to have a value of "true"](../assets/configure-release-branch-test.png)

4. Verify that the Bamboo build for the PR succeeds and then merge to the minor version base branch (`release-1.2.x`).
    - It **is safe** to do a squash merge in this instance, but not required
5. You may delete your release branch (`release-1.2.3`) after merging to the base branch.

### 10. Create a git tag for the release

Check out the minor version base branch (`release-1.2.x`) now that your changes are merged in and do a `git pull`.

Ensure you are on the latest commit.

Create and push a new git tag:

```bash
    git tag -a vMAJOR.MINOR.PATCH -m "Release MAJOR.MINOR.PATCH"
    git push origin vMAJOR.MINOR.PATCH

e.g.:
    git tag -a v9.1.0 -m "Release 9.1.0"
    git push origin v9.1.0
```

### 11. Publishing the release

Publishing of new releases is handled by a custom Bamboo branch plan and is manually triggered.

The reasons for using a separate branch plan to handle releases instead of the branch plan for the minor version (e.g. `release-1.2.x`) are:

- The Bamboo build for the minor version release branch is triggered **automatically** on any commits to that branch, whereas we want to manually control when the release is published.
- We want to verify that integration tests have passed on the Bamboo build for the minor version release branch **before** we manually trigger the release, so that we can be sure that our code is safe to release.

If this is a new minor version branch, then you will need to create a new Bamboo branch plan for publishing the release following the instructions below:

#### Creating a Bamboo branch plan for the release

- In the Cumulus Core project (<https://ci.earthdata.nasa.gov/browse/CUM-CBA>), click `Actions -> Configure Plan` in the top right.

- Next to `Plan branch` click the rightmost button that displays `Create Plan Branch` upon hover.

- Click `Create plan branch manually`.

- Add the values in that list. Choose a display name that makes it _very_ clear this is a deployment branch plan. `Release (minor version branch name)` seems to work well (e.g. `Release (1.2.x)`)).
  - **Make sure** you enter the correct branch name (e.g. `release-1.2.x`).

- ::::note Manage the branch

  :::warning Deselect Enable Branch

    Deselect Enable Branch - if you do not do this, it will immediately fire off a build.

  :::

  :::tip Do Immediately

  On the `Branch Details` page, enable `Change trigger`.  Set the `Trigger type` to manual, this will prevent commits to the branch from triggering the build plan.
  You should have been redirected to the `Branch Details` tab after creating the plan. If not, navigate to the branch from the list where you clicked `Create Plan Branch` in the previous step.

  :::

  ::::

- Go to the `Variables` tab. Ensure that you are on your branch plan and not the `master` plan: You should not see a large list of configured variables, but instead a dropdown allowing you to select variables to override, and the tab title will be `Branch Variables`. Then set the branch variables as follow:

  - `DEPLOYMENT`: `cumulus-from-npm-tf` (**except in special cases such as incompatible backport branches**)
    - If this variable is not set, it will default to the deployment name for the last committer on the branch
  - `USE_CACHED_BOOTSTRAP`: `false`
  - `USE_TERRAFORM_ZIPS`: `true` (**IMPORTANT**: MUST be set in order to run integration tests against the `.zip` files published during the build so that we are actually testing our released files)
  - `GIT_PR`: `true`
  - `SKIP_AUDIT`: `true`
  - `PUBLISH_FLAG`: `true`

- Enable the branch from the `Branch Details` page.

- Run the branch using the `Run` button in the top right.

Bamboo will build and run lint and unit tests against that tagged release, publish the new packages to NPM, and then run the integration tests using those newly released packages.

### 12. Create a new Cumulus release on github

The CI release scripts will automatically create a GitHub release based on the release version tag, as well as upload artifacts to the Github release for the Terraform modules provided by Cumulus. The Terraform release artifacts include:

- A multi-module Terraform `.zip` artifact containing filtered copies of the `tf-modules`, `packages`, and `tasks` directories for use as Terraform module sources.
- A S3 replicator module
- A workflow module
- A distribution API module
- An ECS service module

Make sure to verify the appropriate .zip files are present on Github after the release process is complete.

:::caution important

  Copy the release notes for the new version from the changelog to the description of the new release on the [GitHub Releases page](https://github.com/nasa/cumulus/releases).

:::

:::info Optional

The "Publish" step in Bamboo will push the release artifcats to GitHub (and NPM). If you need more time to validate the release _after_ the packages are published, you can mark the release as a "Pre-Release" on GitHub. This will clearly indicate the that release is not ready for the public. To do this:

- Find the release on [GitHub Releases page](https://github.com/nasa/cumulus/releases)
- Click the "Edit release" button (pencil icon)
- Check the "This is a pre-release" checkbox
- Click "Update release"

:::

### 13. Update Cumulus API document

There may be unreleased changes in the [Cumulus API document](https://github.com/nasa/cumulus-api) that are waiting on the Cumulus Core release.
If there are unrelease changes in the cumulus-api repo, follow the release instruction to create the release, the release version should match
the Cumulus Core release.

### 14. Update Cumulus Template Deploy

Users are encouraged to use our [Cumulus Template Deploy Project](https://github.com/nasa/cumulus-template-deploy) for deployments. The Cumulus Core version should be updated in this repo when a new Cumulus Core version is released.

This will mean updating the `source` property of Cumulus modules with the correct version:

```hcl
module "cumulus" {
  source = "https://github.com/nasa/cumulus/releases/download/{most_current_version}/terraform-aws-cumulus.zip//tf-modules/cumulus"
  ...
}
```

e.g.

```hcl
module "cumulus" {
  source = "https://github.com/nasa/cumulus/releases/download/v16.1.1/terraform-aws-cumulus.zip//tf-modules/cumulus"
  ...
}
```

### 15. Merge base branch back to master

Finally, you need to reproduce the version update changes back to master.

If this is the latest version, you can simply create a PR to merge the minor version base branch back to master.

Do not merge `master` back into the release branch since we want the release branch to _just_ have the code from the release.  Instead, create a new branch off of the release branch and merge that to master. You can freely merge master into this branch and delete it when it is merged to master.

:::note

If this is a backport, you will need to create a PR that merges **ONLY** the changelog updates back to master. It is important in this changelog note to call it out as a backport. For example:

>**Please note** changes in 13.3.2 may not yet be released in future versions, as
>this is a backport and patch release on the 13.3.x series of releases. Updates that
>are included in the future will have a corresponding CHANGELOG entry in future
>releases..

:::

## Troubleshooting

### Delete and regenerate the tag

To delete a published tag to re-tag, follow these steps:

```bash
  git tag -d vMAJOR.MINOR.PATCH
  git push -d origin vMAJOR.MINOR.PATCH

e.g.:
  git tag -d v9.1.0
  git push -d origin v9.1.0
```
