# @cumulus/db

Utilities for working with the Cumulus database.

## Versioning

Cumulus uses a modified semantic versioning scheme and minor releases likely
include breaking changes.

Before upgrade, please read the Cumulus
[release notes](https://github.com/nasa/cumulus/releases) before upgraded.

It is strongly recommended you do not use `^` in your `package.json` to
automatically update to new minor versions. Instead, pin the version or use `~`
to automatically update to new patch versions.

## Installation

```bash
  npm install @cumulus/db
```

## Contents

### Types

TypeScript interfaces describing the data types stored in the Cumulus database are found in the `/types` directory.

Typically, there are two TypeScript interfaces describing each Cumulus data type. For example:

- `PostgresProvider`: Describes the data structure ready for insertion into the Cumulus Postgres database
- `PostgresProviderRecord`: Describes the data structure after retrieval from the Cumulus database. This data type usually includes extra required properties (such as the auto-incremented primary key field), since those properties will exist once a record has been created.

### BigInt cumulus_id columns

For the BigInt columns, knex returns postgres as "string" type. In order to use cumulus_id as a number,
we are converting the return string from columns ending with "cumulus_id" to Number.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please
[see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
