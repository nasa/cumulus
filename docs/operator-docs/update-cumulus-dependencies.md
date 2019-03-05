---
id: update-cumulus-dependencies
title: Update Cumulus Dependencies
hide_title: true
---

# Updating Cumulus Dependencies

This document will outline, step by step, how to update a Cumulus deployment to a newer version. It is currently assumed that _all_ Cumulus packages are to be updated to the same version at the same time.

## Check Current Version

In the directory from which you deploy Cumulus (the directory that has `app/` and `iam/` sub-directories), run the following:

```shell
$ (cd node_modules && for x in @cumulus/*; do v=$(grep version $x/package.json | cut -d '"' -f 4); echo "$x@$v"; done)
@cumulus/api@1.11.0
@cumulus/common@1.11.0
@cumulus/deployment@1.11.0
...
@cumulus/test-processing@1.11.0
```

The command above lists the Cumulus packages and their version in the format `@cumulus/<package>@<version>`. Note that `<version>` is your current version.

## Update to Latest Version

One can update packages using the `npm update` command.

To upgrade all Cumulus to the latest Cumulus version:

```shell
for x in $(ls node_modules/@cumulus/); do npm update @cumulus/$x; done
```

To upgrade an individual Cumulus `<package>` to the latest version:

```shell
$ npm update @cumulus/<package>
```

## Update to a Specific Version

To upgrade individual Cumulus packages to a specific `<version>` is fairly simple: For each package,

```shell
$ npm update @cumulus/<package>@<version>
```

*Note:* `<version>` is a version string that observes the syntactic rules outlined [here](https://docs.npmjs.com/files/package.json#dependencies).


## Redeploy

Note that there may be configuration changes required with a new version. Please check the [release documentation](https://github.com/nasa/cumulus/releases) for instructions regarding deployment/stack configuration. Once configuration is in an acceptable state, deployment commands should be the same as before.

```shell
# IAM Deployment
./node_modules/.bin/kes cf deploy --kes-folder iam --deployment <deployment> --template node_modules/@cumulus/deployment/iam --region <aws-region>

# Cumulus Stack Deployment
./node_modules/.bin/kes cf deploy --kes-folder app --region <aws-region> --template node_modules/@cumulus/deployment/app  --deployment <deployment>
```


## Migrating to New Version

When breaking changes have been introduced, the Cumulus Core team will publish a document with instructions on migrating from one version to another. *IMPORTANT:* When upgrading through many versions, each migration should be done in the order of release (if going from version 1.z.0 from 1.x.0, 1.x.0 -> 1.y.0 -> 1.z.0).

The migration documents published on release can be found [here](https://nasa.github.io/cumulus/docs/upgrade/upgrade-readme).
