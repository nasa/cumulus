# Cumulus - Data model

Cumulus uses DynamoDB for database storage. While DynamoDB is a schemaless database storage system, Cumulus enforces schemas on record creation and update using the [`ajv` package](https://github.com/epoberezkin/ajv).

The data models managed by Cumulus and their schema definitions can be found in the [Cumulus source code](./packages/api/models/schemas.js).

## Data model changes

By default, all changes to Cumulus data models should be **backwards-compatible with all previous versions of the data models**. By "backwards-compatible", we mean:

- Cumulus API endpoint responses have the same structure and properties

Thus, any changes to the underlying data model schemas would require corresponding functions to translate between the updated schemas and all previous versions of the schemas so that data read from the models would conform to the same format.

Backwards compatibility is required because all data that Cumulus manages must be readable and usable in a consistent format. Furthermore, given that Cumulus is actively being used in operational environments which are continuously ingesting petabytes of data, if backwards compatibility were not enforced it would not be realistic to assume that all previously ingested data would be re-ingested to conform to the updated schemas.
