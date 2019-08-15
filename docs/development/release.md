# Versioning and Releases

## Versioning

We use a global versioning approach, meaning version numbers in cumulus are consistent across all packages and tasks, and semantic versioning to track major, minor, and patch version (i.e. 1.0.0). We use Lerna to manage our versioning. Any change will force lerna to increment the version of all packages.

Read more about the semantic versioning [here](https://docs.npmjs.com/getting-started/semantic-versioning).

## Updating Cumulus version and publishing to NPM

### 1. Create a branch for the new release

#### From Master

If creating a new minor version release from master, create a branch titled `release-1.MINOR.x` (e.g. release-1.14.x) as a feature branch from master to allow us to easily backport patches to that version.  Then create a release branch from it.

The name is not important, but `release-x.y.z` seems like a good choice.

#### Backporting

Checkout the release-major.minor.patch branch, then create a release branch from it.    If the release-major.minor.patch branch does not exist, checkout the major.0.0 release tag and create a new maintenance branch, then create a release branch from it. 

The name is not important, but `release-x.y.z` seems like a good choice.

### 2. Update the Cumulus version number

When changes are ready to be released, the Cumulus version number must be updated.

Lerna handles the process of deciding which version number should be used as long as the developer specifies whether the change is a major, minor, or patch change.

To update Cumulus's version number run:

```bash
  $ npm run update
```

![](https://static.notion-static.com/13acbe0a-c59d-4c42-90eb-23d4ec65c9db/Screen_Shot_2018-03-15_at_12.21.16_PM.png)

Lerna will handle updating the packages and all of the dependent package version numbers. If a dependency has not been changed with the update, however, lerna will not update the version of the dependency.

### 3. Check Cumulus Dashboard PRs for Version Bump

There may be unreleased changes in the Cumulus Dashboard [project](https://github.com/nasa/cumulus-dashboard) that rely on this unreleased Cumulus Core version.

If there is exists a PR in the cumulus-dashboard repo with a name containing: "Version Bump for Next Cumulus API Release":

* There will be a placeholder `change-me` value that should be replaced with the Cumulus Core to-be-released-version.
* Mark that PR as ready to be reviewed.

### 4. Update CHANGELOG.md

Update the CHANGELOG.md. Put a header under the 'Unreleased' section with the new version number and the date.

Add a link reference for the github "compare" view at the bottom of the CHANGELOG.md, following the existing pattern. This link reference should create a link in the CHANGELOG's release header to changes in the corresponding release.

### 5. Cut new version of Cumulus Documentation

```shell
cd website
npm run version ${release_version}
git add .
```

Where `${release_version}` corresponds to the version tag `v1.2.3`, for example.

Note: This is for 1.10.3 or later.

### 6. Create a pull request against the feature branch/master

Create a PR against the feature branch. Verify that the Bamboo build for the PR succeeds and then merge to the feature branch.

### 7. Create a git tag for the release
Create and push a new git tag:

```bash
  $ git tag -a v1.x.x -m "Release 1.x.x"
  $ git push origin v1.x.x
```
### 8. Running the deployment

Publishing of new releases is handled by a Bamboo release plan and is manually triggered.

If you created a new release plan in step one, you will need to create a new bamboo deployment plan

#### Creating a Bamboo Deployment plan:

* In the Cumulus Core project (https://ci.earthdata.nasa.gov/browse/CUM-CBA), click Actions -> Configure Plan

* Scroll to the bottom of the branch list and click `Create Plan Branch`

* Click `Create plan branch manually`

* Add the values in that list.   Choose a display name that makes it *very* clear this is a deployment branch plan.    `Release (branch name)` seems to work well.    *Make sure* you select the correct branch

* **Important** Deselect Enable Branch - if you do not do this, it will immediately fire off a build

* **Immediately** go to plan configuration on the `Branch Details` tab, and enable `Change trigger`.  Set the `Trigger type` to manual, this will prevent commits to the branch from triggering the build plan

* Go to the branch plan and set GIT_PR, USE_NPM_PACKAGES and PUBLISH_FLAG to true.  Select a DEPLOYMENT appropriate for the release (otherwise it will use the default last committer)

Bamboo will build and run lint, audit and unit tests against that tagged release, publish the new packages to NPM, and then run the integration tests using those newly released packages.

### 9. Create a new Cumulus release on github

The Cumulus Distribution Terraform module can be created by running:

```bash
$ (cd tf-modules/distribution && ./bin/build-tf-module.sh)
```

This will generate a file called
`tf-modules/distribution/dist/terraform-aws-cumulus-distribution.zip`, which
should be uploaded as an asset of the Github release.

Similarily, the S3 Replicator Terraform module can be created by running:

```bash
$ (cd tf-modules/s3-credentials && ./bin/build-tf-module.sh)
```

## Troubleshooting

### Delete and regenerate the tag

To delete a published tag to re-tag, follow these steps:

```bash
  $ git tag -d v1.x.x
  $ git push -d origin v1.x.x
```
