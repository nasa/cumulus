---
id: cumulus-dependencies
title: Cumulus Dependencies
hide_title: true
---

# Updating Cumulus Dependencies


## Cumulus Dependency Management - A Quick Intro to package.json

As is standard with nodejs projects, Cumulus has lists of dependencies in `package.json` files. For this example, we'll look at the `package.json` file under the `example` directory in the main [Cumulus project](github.com/nasa/cumulus).

In the `package.json` file, both the `dev_dependencies` and `dependencies` attributes should exist. The `dev_dependencies` are packages that are used in development, but are not necessary for deployment/usage of the package; a good example of this would be testing frameworks (`ava`) or mocking packages. The `dependencies` attribute lists all the required packages for using the software. Cumulus core developed dependencies all are prefixed with `@cumulus/` (i.e. the ingest package is listed as `@cumulus/ingest`).

Example:
```json
...
dependencies: {
  "@cumulus/api": ^1.11.1,
  "@cumulus/ingest": ^1.11.1,
  ...
}
```

A detailed explanation of the dependency version syntax (`^1.11.1`) can be found in the npm package.json [documentation](https://docs.npmjs.com/files/package.json#dependencies). That page also has detailed documentation outlining many facets of the `package.json`.


## Finding Cumulus Releases

Cumulus core releases can be found in the github repository ([here](https://github.com/nasa/cumulus/releases)).


## Walkthrough

First, we'll pull the `cumulus-template-deploy` [repository](github.com/nasa/cumulus-template-deploy) from GitHub into a local `test-deployment` directory. This will give us a bare-minimum starting point for configuring a deployment.
`git clone https://github.com/nasa/cumulus-template-deploy.git test-deployment`

Let's take a look at the `dependencies` in the local repository's `package.json`:

```json
dependencies: {
  "@cumulus/api": "^1.9.0",
  "@cumulus/deployment": "^1.9.0",
  "@cumulus/hello-world": "^1.9.0",
  "kes": "^2.2.2",
  "node-forge": "^0.7.1"
}
```

## Pinning a Version

At the time of writing this document, the dependency versions are all prefixed with a `^` character. According to the `npm pacakge.json` [documentation](https://docs.npmjs.com/files/package.json#dependencies), the `^` means that the version will match any releases with a higher minor or patch version. For example, `"^1.9.0"` will match version `1.9.1` and `1.11.0`, but it will not match `2.0.0`. This is just fine for development, but in an operations environment it is valuable to pin a specific version.

To pin our dependency to a specific version, we just have to remove the `^`. That is, `"^1.9.0"` -> `"1.9.0"`.


## Changing a Version

Changing the version should be rather straight-forward. In the instance of `@cumulus` dependenies, we can find the versioned releases on the GitHub [releases page](github.com/nasa/cumulus/releases). To update `@cumulus/api` to `1.11.1`, simply change the line to `"@cumulus/api": "1.11.1",`.

