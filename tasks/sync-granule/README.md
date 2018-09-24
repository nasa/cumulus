# @cumulus/sync-granule

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

Download a given granule from a given provider to S3

## Message Configuration
### Config

| field name | default | values | description
| --------   | ------- | ---------- | ----------
| provider   | (required) | | The cumulus-api provider object
| buckets     | (required) | | Object specifying AWS S3 buckets used by this task
| downloadBucket      | (required) | | Name of AWS S3 bucket to use when downloading files
| onDuplicateFilename      | error | <ul><li>`error` - Throws an error on duplicates</li><li>`replace` - Replaces the existing file</li><li>`skip` - Skips the duplicate file</li><li>`version` - Adds a suffix to the duplicate filename to avoid a clash</li></ul> | Specifies how duplicate filenames should be handled

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)
