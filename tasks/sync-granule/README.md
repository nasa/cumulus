# @cumulus/sync-granule

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

Download a given granule from a given provider to S3

## Message Configuration
### Config

| field name | type | default | values | description
| --------   | ------- | ------- | ---------- | ----------
| buckets | object | (required) | | Object specifying AWS S3 buckets used by this task
| downloadBucket | string | (required) | | Name of AWS S3 bucket to use when downloading files
| provider | object | (required) | | The cumulus-api provider object
| collection | object | | | The cumulus-api collection object
| fileStagingDir | string | | | Directory used for staging location of files. Default is `file-staging`. Granules are further organized by stack name and collection name making the full path `file-staging/<stack name>/<collection name>`
| forceDownload | boolean | false | |
| onDuplicateFilename | string | error | <ul><li>`error` - Throws an error on duplicates</li><li>`replace` - Replaces the existing file</li><li>`skip` - Skips the duplicate file</li><li>`version` - Adds a suffix to the duplicate filename to avoid a clash</li></ul> | Specifies how duplicate filenames should be handled
| pdr | object | | | Object containing the name and path for a PDR file
| stack | string | | | The name of the deployment stack to use. Useful as a prefix.

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)
