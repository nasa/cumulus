# Cumulus - Data model

Cumulus uses DynamoDB for database storage. While DynamoDB is a schemaless database storage system, Cumulus enforces schemas on record creation and update using the [`ajv` package](https://github.com/epoberezkin/ajv).

The data models managed by Cumulus and their schema definitions can be found in the [Cumulus source code](./packages/api/models/schemas.js).

## Documenting changes

All changes to the database models must be noted in the [data model CHANGELOG](./DATA_MODEL_CHANGELOG.md). Tracking backwards compatibility will otherwise be extremely difficult.

## Managing data schemas

By default, all changes to Cumulus data models should be **backwards-compatible with all previous versions of the data models since the last data migration (if any)**.

By "backwards-compatible", we mean that **any new required fields must be nullable or translatable**.

Making new field(s) translatable means that they must be able to be populated from data contained in **any previous version of the database schema**.

Enforcing backwards compatibility means that database operations must conform to the following rules:

- Database writes must be able to accept **any schema version**
- Database reads should be translated to always return responses matching the **latest schema version**

Preferably, consistency for database reads should be implemented by updating the database model read method to populate the value of new field(s) based on existing data in the records.

## Risks of breaking changes to schemas

In a Cumulus operational deployment, there may be very long running ingest workflows that cannot be stopped to upgrade the Cumulus deployment to a new version. Thus, a new version of Cumulus with updated schemas may be deployed during a long running workflow execution.

Even if the deployed schema changes were breaking changes, then the **workflow execution itself would not fail** due to workflow lambda versioning that pins workflow tasks to a specific version of the code and thus to a specific version of the model schemas as well.

However, there would be other harmful consequences of deploying breaking schema changes:

- [Workflow reporting](./docs/interfaces.md) Lambdas, which are not versioned, could receive data from a long-running workflow in an old schema format but attempt to save the record according to the new schema, which would fail. Thus, even "successful" workflows would not have any archived records associated with them nor be visible to Cumulus operators
- API responses would be inconsistent, which could be problematic for API consumers

While it is technically possible to version API endpoints to isolate different responses and to prevent impacting API consumers, producing a consistent response even for a given API version would require a migration script that would convert data from all schema versions prior to the breaking change to conform to the latest schema. Otherwise, even requests to a versioned API endpoint could produce inconsistent responses from the prior schema versions.

### Supporting breaking changes

If for some reason, schema changes must be made that cannot be made backwards compatible, then this change needs to be discussed in an architecture meeting of the Cumulus core development team.

If the change is approved, then a **migration script must be provided** to update all existing data stored by Cumulus to the new schemas. In order to run the migration, there will be necessary downtime for ingest operations, otherwise ongoing workflows would continue to save records that are incompatible with the new schemas.

Once a migration has been performed, then the expectation of backwards compatibility is relative to **all versions of the schemas since the most recent data migration**.

## Release guidelines

- Backwards compatible schema changes can be released in a minor version of Cumulus
- Breaking schema changes **should be released in a major version of Cumulus**
