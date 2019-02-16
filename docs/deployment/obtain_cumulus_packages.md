---
id: obtain_cumulus_packages
title: Obtaining Cumulus Packages
hide_title: true
---

# Obtaining Cumulus Packages

## Option 1: Get packages from NPM

Use this option to get released versions of Cumulus packages. If you want to use an unreleased version or modify the packages, use option 2.

Packages are installed with npm. A list of Cumulus packages with descriptions and version information can be found [here](https://www.npmjs.com/org/cumulus).

If you're trying to work with a certain version of a cumulus package or task, the version can be specified in `package.json` under dependencies. We use semantic versioning (major/minor/patch). You can also configure for automatic updates. Use `^` to update minor/patch versions automatically and `~` to automatically update patch versions. For example:

    "@cumulus/sync-granule": "^1.0.0"

To add a new package to your deployment, install via npm. Without a version specified, it will automatically install the latest version. For example:

    $ npm install --save @cumulus/deployment

To use the specific version of the package installed during deployment, point the `source` key in the lambda config to `node_modules/@cumulus/<package-name>/dist`. This location may vary between packages, so consult the README in each. For example, the following would update patch and minor versions of sync-granule:

    SyncGranule:
      source: 'node_modules/@cumulus/sync-granule/dist/'

## Option 2: Make local copy of the `Cumulus` repository and prepare it.

Use this option only if you want to use an unreleased version of a package or you want to modify a package.

Clone repository

    $ git clone https://github.com/nasa/cumulus.git

Change directory to the repository root

    $ cd cumulus

Optionally, If you are deploying a particular version(tag), ref or branch of Cumulus core, you should check out that particular reference

    $ git checkout \<ref/branch/tag\>

Install and configure the local build environment and dependencies using npm

    $ nvm use
    $ npm install
    $ npm run ybootstrap

Build the Cumulus application

    $ npm run build

To run the Cumulus deployment with the local code instead of the npm package, use `npm link` from your deployment repository directory

    $ npm link ../cumulus/packages/deployment/ @cumulus/deployment

Note: If you get errors with `npm link`, try deleting the `node_modules` folder for the package you are trying to link to in the Cumulus repository.