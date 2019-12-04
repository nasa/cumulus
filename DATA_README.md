# Cumulus - Data model

Cumulus uses DynamoDB for database storage. While DynamoDB is a schemaless database storage system, Cumulus enforces schemas on record creation and update using the [`ajv` package](https://github.com/epoberezkin/ajv).

The data models managed by Cumulus and their schema definitions can be found in the [Cumulus source code](./packages/api/models/schemas.js).

## Managing data schemas

By default, all changes to Cumulus data models should be **backwards-compatible with all previous versions of the data models since the last data migration (if any)**. By "backwards-compatible", we mean:

- Cumulus API endpoint responses have the same structure and properties

Thus, any changes to the underlying data model schemas would require corresponding functions to translate between the updated schemas and all previous versions of the schemas so that data read from the models would conform to the same format.

Backwards compatibility is required because all data that Cumulus manages must be readable and usable in a consistent format. Furthermore, given that Cumulus is actively being used in operational environments which are continuously ingesting petabytes of data, if backwards compatibility were not enforced it would not be realistic to assume that all previously ingested data would be re-ingested to conform to the updated schemas.

### Migration scripts

If for some reason, schema changes must be made that cannot be made backwards compatible, then a migration script **must be provided** to update all existing data stored by Cumulus to the new schemas.

Once a migration has been performed, then the expectation of backwards compatibility is relative only to **all versions of the schemas since the most recent data migration**.
