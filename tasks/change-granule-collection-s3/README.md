# @cumulus/change-granule-collection-s3

This lambda function moves granules between collections in s3 and in postgres

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name | type | default | values | description
| ---------- | ---- | ------- | ------ | -----------

| buckets | object | (required) | | Object specifying AWS S3 buckets used by this task
| collection | object | (required) | | The cumulus-api collection object
| distribution_endpoint | string | (required) | | The API distribution endpoint
| s3MultipartChunksizeMb | number | | | S3 multipart upload chunk size in MB.  If none is specified, the default `default_s3_multipart_chunksize_mb` is used.

### Input

Input object fields:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
| granules | array\<object\> | (required) | List of granule objects

### Output

Output object fields:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
granules | array\<object\> | N/A | List of granule objects with updated S3 location information

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
