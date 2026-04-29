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

For the BigInt columns, knex returns postgres as "string" type. In order to use cumulus_id as a number, knex hook
postProcessResponse is configured to convert the return string from columns ending with "cumulus_id" to number.

### Database Migration

We have scripts to initialize or update the database schema. The system can choose between a "clean slate"
setup and an "incremental patch" approach depending on the state of the database and the configuration.

- Standard Migrations (src/migrations/):
These are the default operational files. They follow an incremental patch-based model, applying specific,
versioned changes (e.g., adding a column, creating a new index) to an existing database. This is used
for standard updates where data must be preserved and the schema evolved over time.
- Bootstrap Directory (src/migrations-bootstrap/):
This directory contains the full declarations required to build a clean database from scratch. Instead
of a long history of patches, the bootstrap process uses optimized scripts to define the entire schema
(tables, constraints, and initial partitions) in one pass. This is significantly faster for fresh
deployments and ensures a consistent, modern baseline.
**Note**: A database created using the Bootstrap process is fully compatible with the migration history;
it can be updated with Standard Migrations later as new patches are released.

#### Creating a new migration

```sh
  npx knex migrate:make migration_name
```

This will create a new migration file under src/migrations.
**Important**: Since the Standard Migrations use an incremental patch-based model and the Bootstrap
Directory uses a declarative "clean slate" model, any changes made to the schema via a new migration
file must also be manually reflected in the corresponding files under src/migrations-bootstrap. This
ensures that fresh deployments using the bootstrap process remain consistent with the latest schema version.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please
[see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
