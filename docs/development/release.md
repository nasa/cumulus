# Versioning and Releases

## Versioning

We use a global versioning approach, meaning version numbers in cumulus are consistent across all packages and tasks, and semantic versioning to track major, minor, and patch version (i.e. 1.0.0). We use Lerna to manage our versioning. Any change will force lerna to increment the version of all packages.

Read more about the semantic versioning [here](https://docs.npmjs.com/getting-started/semantic-versioning).

## Updating Cumulus version and publishing to NPM

### 1. Create a branch for the new release

#### From Master

If creating a new minor version release from master, create a branch titled `release-MAJOR.MINOR.x` (e.g. release-1.14.x) as a minor version base branch from master to allow us to easily backport patches to that version. Push the `release-MAJOR.MINOR.x` branch to GitHub if it was created locally. (Commits should be even with master at this point.)

If creating a patch release, you can check out the existing base branch.
Then create the release branch (e.g. release-1.14.0) from the minor version base branch.

#### Backporting

When creating a backport, a minor version base branch should already exist on GitHub.
Check out the existing minor version base branch then create a release branch from it.

### 2. Update the Cumulus version number

When changes are ready to be released, the Cumulus version number must be updated.

Lerna handles the process of deciding which version number should be used as long as the developer specifies whether the change is a major, minor, or patch change.

To update Cumulus's version number run:

```bash
  npm run update
```

![Screenshot of terminal showing interactive prompt from Lerna for selecting the new release version](https://static.notion-static.com/13acbe0a-c59d-4c42-90eb-23d4ec65c9db/Screen_Shot_2018-03-15_at_12.21.16_PM.png)

Lerna will handle updating the packages and all of the dependent package version numbers. If a dependency has not been changed with the update, however, lerna will not update the version of the dependency.

**Note:** Lerna will struggle to correctly update the versions on any non-standard/alpha versions (e.g. 1.17.0-alpha0).
Please be sure to check any packages that are new or have been manually published since the previous release and any packages that list it as a dependency to ensure the listed versions are correct.

### 3. Check Cumulus Dashboard PRs for Version Bump

There may be unreleased changes in the Cumulus Dashboard [project](https://github.com/nasa/cumulus-dashboard) that rely on this unreleased Cumulus Core version.

If there is exists a PR in the cumulus-dashboard repo with a name containing: "Version Bump for Next Cumulus API Release":

* There will be a placeholder `change-me` value that should be replaced with the Cumulus Core to-be-released-version.
* Mark that PR as ready to be reviewed.

### 4. Update CHANGELOG.md

Update the CHANGELOG.md. Put a header under the 'Unreleased' section with the new version number and the date.

Add a link reference for the github "compare" view at the bottom of the CHANGELOG.md, following the existing pattern. This link reference should create a link in the CHANGELOG's release header to changes in the corresponding release.

### 5. Cut new version of Cumulus Documentation

If this is a backport, do not version documentation. For various reasons, we do not merge backports back to master, other than changelog notes. Doc changes will not be published to our documentation website.

```shell
cd website
npm run version ${release_version}
git add .
```

Where `${release_version}` corresponds to the version tag `v1.2.3`, for example.

Note: This is for 1.10.3 or later.

### 6. Create a pull request against the minor version branch

Push the release branch to GitHub.
Create a PR against the minor version base branch.
Verify that the Bamboo build for the PR succeeds and then merge to the minor version base branch.
You may delete your release branch after merging to the base branch.

### 7. Create a git tag for the release

Check out the minor version base branch now that your changes are merged in.
Ensure you are on the latest commit.

Create and push a new git tag:

```bash
  git tag -a v1.x.x -m "Release 1.x.x"
  git push origin v1.x.x
```

### 8. Running the deployment

Publishing of new releases is handled by a Bamboo release plan and is manually triggered.

If you created a new release plan in step one, you will need to create a new bamboo deployment plan

#### Creating a Bamboo Deployment plan

* In the Cumulus Core project (<https://ci.earthdata.nasa.gov/browse/CUM-CBA>), click `Actions -> Configure Plan` in the top right.

* Scroll to the bottom of the branch list in the bottom left and click `Create Plan Branch`.

* Click `Create plan branch manually`.

* Add the values in that list. Choose a display name that makes it *very* clear this is a deployment branch plan. `Release (branch name)` seems to work well. *Make sure* you enter the correct branch name.

* **Important** Deselect Enable Branch - if you do not do this, it will immediately fire off a build.

* **Do Immediately** On the `Branch Details` page, enable `Change trigger`.  Set the `Trigger type` to manual, this will prevent commits to the branch from triggering the build plan.
You should have been redirected to the `Branch Details` tab after creating the plan. If not, navigate to the branch from the list where you clicked `Create Plan Branch` in the previous step.

* Go to the `Variables` tab. Ensure that you are on your branch plan and not the `master` plan: You should not see a large list of configured variables, but instead a dropdown allowing you to select variables to override, and the tab title will be `Branch Variables`. Set a DEPLOYMENT variable appropriate for the release (defaults to last committer). This should be `cumulus-from-npm-tf` *except* in special cases such as incompatible backport branches. Then set:

* `USE_CACHED_BOOTSTRAP`: `false`,
* `USE_TERRAFORM_ZIPS`: `true`, (**IMPORTANT**: MUST be set in order to run integration tests vs. the zips published during the build and actually test our released files)
* `GIT_PR`: `true`,
* `SKIP_AUDIT`: `true`,
* `PUBLISH_FLAG`: `true`

* Enable the branch from the `Branch Details` page.

* Run the branch using the `Run` button in the top right.

Bamboo will build and run lint, audit and unit tests against that tagged release, publish the new packages to NPM, and then run the integration tests using those newly released packages.

### 9. Create a new Cumulus release on github

The CI release scripts will automatically create a release based on the release version tag, as well as uploading release artifacts to the Github release for the Terraform modules provided by Cumulus. The Terraform release artifacts include:

* A multi-module Terraform `.zip` artifact containing filtered copies of the `tf-modules`, `packages`, and `tasks` directories for use as Terraform module sources.
* A S3 replicator module
* A workflow module
* A distribution API module
* An ECS service module

Just make sure to verify the appropriate .zip files are present on Github after the release process is complete.

### 10. Merge base branch back to master

Finally, you need to reproduce the version update changes back to master.

If this is the latest version, you can simply create a PR to merge the minor version base branch back to master.
**Note:** Do not squash this merge. Doing so will make the "compare" view from step 4 show an incorrect diff, because the tag is linked to a specific commit on the base branch.

If this is a backport, you will need to create a PR that ports the changelog updates back to master.
It is important in this changelog note to call it out as a backport.
For example, fixes in backport version 1.14.5 may not be available in 1.15.0 because the fix was introduced in 1.15.3.

## Troubleshooting

### Delete and regenerate the tag

To delete a published tag to re-tag, follow these steps:

```bash
  git tag -d v1.x.x
  git push -d origin v1.x.x
```
