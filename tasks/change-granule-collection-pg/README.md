# @cumulus/change-granule-collection-pg

This lambda function moves granules between collections in cumulus datastores (elasticsearch and postgres)

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name | type | description |
| ---------- | ---- | ----------- |
| buckets | object | (required) Object specifying AWS S3 buckets used by this task |
| collection | object | (required) The cumulus-api collection that these granules started in |
| targetCollection | object | (required) The cumulus-api collection that these granules should be moved it |

### Input

Input object fields:

| field name | type | description |
| ---------- | ---- | ----------- |
| granules | array\<object\>  | (required) List of granule objects post-update to new collection |
| oldGranules | array\<object\>  | (required) List of granules pre-update to new collection |

### Output

Output object fields:

| field name | type | description |
| ---------- | ---- | ----------- |
granules | array\<object\> | List of granule objects with updated S3 location and PG fields |

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
