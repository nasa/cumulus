# @cumulus/move-granules

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

This lambda function is responsible for moving granule files from a file staging location to their final location.

## Message Configuration
### Config

| field name | type | default | values | description
| --------   | ------- | ------- | ---------- | ----------
| bucket | string | (required) | | Bucket with public/private key for decrypting CMR password
| buckets | object | (required) | | Object specifying AWS S3 buckets used by this task
| collection | object | (required) | | The cumulus-api collection object
| distribution_endpoint | string | (required) | | The API distribution endpoint
| input_granules | array\<object\> | (required) | | Array of Granule objects to construct output for Cumulus indexer
| duplicateHandling | string | `error` | <ul><li>`error` - Throws an error on duplicates</li><li>`replace` - Replaces the existing file</li><li>`skip` - Skips the duplicate file</li><li>`version` - Adds a suffix to the existing filename to avoid a clash</li></ul> | Specifies how duplicate filenames should be handled
| granuleIdExtraction | string | | | The regex needed for extracting granuleId from filenames
| moveStagedFiles | boolean | `true` | | Can set to `false` to skip moving files from the staging location. Defaults to `true`.
| reingestGranule | boolean | false | `true` - The manually-triggered reingest always overwrites existing files | Indicates that the workflow is a manually triggered re-ingest. The parameter should be set to `{$.meta.reingestGranule}`.

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)
