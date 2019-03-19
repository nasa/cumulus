# @cumulus/move-granules

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

This lambda function is responsible for moving granule files from a file staging location to their final location.

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name | type | default | values | description
| ---------- | ---- | ------- | ------ | -----------
| bucket | string | (required) | | Bucket with public/private key for decrypting CMR password
| buckets | object | (required) | | Object specifying AWS S3 buckets used by this task
| collection | object | (required) | | The cumulus-api collection object
| distribution_endpoint | string | (required) | | The API distribution endpoint
| duplicateHandling | string | `error` | <ul><li>`error` - Throws an error on duplicates</li><li>`replace` - Replaces the existing file</li><li>`skip` - Skips the duplicate file</li><li>`version` - Adds a suffix to the existing filename to avoid a clash</li></ul> | Specifies how duplicate filenames should be handled
| moveStagedFiles | boolean | `true` | | Can set to `false` to skip moving files from the staging location. Defaults to `true`.

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

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)
