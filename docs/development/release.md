# Versioning and Releases

## Versioning

We use a global versioning approach, meaning version numbers in cumulus are consistent across all packages and tasks, and semantic versioning to track major, minor, and patch version (i.e. 1.0.0). We use Lerna to manage our versioning. Any change will force lerna to increment the version of all packages.

Read more about the semantic versioning [here](https://docs.npmjs.com/getting-started/semantic-versioning).

## Updating Cumulus version and publishing to NPM

### 1. Create a branch for the new release

The name is not important, but `release-x.y.z` seems like a good choice.

### 2. Update the Cumulus version number

When changes are ready to be released, the Cumulus version number must be updated.

Lerna handles the process of deciding which version number should be used as long as the developer specifies whether the change is a major, minor, or patch change.

To update cumulus' version number run:

     $ yarn update

![](https://static.notion-static.com/13acbe0a-c59d-4c42-90eb-23d4ec65c9db/Screen_Shot_2018-03-15_at_12.21.16_PM.png)

Lerna will handle updating the packages and all of the dependent package version numbers. If a dependency has not been changed with the update, however, lerna will not update the version of the dependency.

### 3. Check Cumulus Dashboard PRs for Version Bump

There may be unreleased changes in the Cumulus Dashboard [project](https://github.com/nasa/cumulus-dashboard) that rely on this unreleased Cumulus Core version.

If there is exists a PR in the cumulus-dashboard repo with a name containing: "Version Bump for Next Cumulus API Release":
* There will be a place-holder `change-me` value that should be replaced with the Cumulus Core to-be-released-version.
* Mark that PR as ready to be reviewed.

### 4. Update CHANGELOG.md

Update the CHANGELOG.md. Put a header under the 'Unreleased' section with the new version number and the date.

Add a link reference for the github "compare" view at the bottom of the CHANGELOG.md, following the existing pattern. This link reference should create a link in the CHANGELOG's release header to changes in the corresponding release.

### 5. Update example/package.json

Update example/package.json to point to the new Cumulus packages. If this is a backport, pin the version of the Cumulus packages to the specific version being released. Do not use `^` or `~`.

### 6. Cut new version of Cumulus Documentation

```shell
cd website
yarn run version ${release_version}
git add .
```

Where `${release_version}` corresponds to the version tag `v1.2.3`, for example.

Note: This is for 1.10.3 or later.

### 7. Create a pull request against the master branch

Create a PR against the `master` branch. Verify that the Travis CI build for the PR succeeds and then merge to master. Once merged, the release branch can be deleted.

### 8. Create a git tag for the release

Publishing of new releases is handled by Travis CI and is triggered when the release tag is pushed to Github. This tag should be in the format `v1.2.3`, where `1.2.3` is the new version.

Create and push a new git tag:

```
$ git tag -a v1.x.x -m "Release 1.x.x"
$ git push origin v1.x.x
```

Travis will build and run tests against that tagged release, publish the new packages to NPM, and then run the integration tests using those newly released packages.

## Backporting to a previous release

Creating a new release for an older major or minor version is similar to creating any other release. Create a branch starting at the tag of the previous release, then follow the [instructions for creating a new release](#updating-cumulus-version-and-publishing-to-npm).

For example, if versions 1.7.0 and 1.8.0 had been published and you wanted to create a 1.7.1 release, you would create the release branch by running `git checkout -b release-1.7.1 v1.7.0`.
