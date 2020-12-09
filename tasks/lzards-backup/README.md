# @cumulus/lzards-backup

This is a [Cumulus](https://nasa.github.io/cumulus) task which will take a list of Cumulus granule objects and based on granule collection configuration make requests to the configured LZARDS API for backup as appropriate.

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see
[the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

There are no configuration fields defined for this task.

### Input

Example:

The following shows the minimal set of keys required for an input payload:

```json
{
  "granules": [
    {
      "granuleId": "FakeGranule001",
      "dataType": "FakeGranuleType",
      "version": "006",
      "files": [
        {
          "filename": "s3://fakeBucket1//path/to/granule1/foo.jpg",
          "bucket": "fakeBucket",
          "checksumType": "md5",
          "checksum": "someChecksum"
        },
        {
          "filename": "s3://fakeBucket1//path/to/granule1/foo.dat",
          "bucket": "fakeBucket",
          "checksumType": "md5",
          "checksum": "someChecksum"
        },
      ]
    }
  ]
}
```

Each granule *must* have a `dataType` and `version` to associate it with a Cumulus collection.

In addition to the task schema requirements, any granule files that are to be backed up *must* have a `checksumType` (md5 | sha256) with a value for `checksum` as LZARDS requires a checksum value.

For a granule file to be backed up, the following should be added to the Collection file configuration for that filetype:

```json
{ "lzards": { "backup": true } }
```

### Output

The task output will contain the results of the requests to LZARDS.   Please note that this task does *not* halt waiting for a response from LZARDS, and *does not* fail if LZARDS rejects an individual backup request.    The task *will* throw if there is an error thrown unrelated to a LZARDS API call, but attempt to complete all requests before it does so.

Upon completion the lambda will return the following structure:

```json
{
  "originalPayload": "<Object containing the original payload>",
  "backupResults": "<Object containing the backup request results>"
}
```

`originalPayload` is provided to seamless ly allow the granules payload to continue downstream of the task (for database writes, etc)

`backupResults` is an object array that contains:

- `body`       : body returned from the LZARDS API query
- `filename`   : original s3 URI to the archived file
- `granuleId`  : granuleId associated with the archival request
- `status`     : 'status' of the request.   Will either be COMPLETED or FAILED
- `statusCode` : status code returned from LZARDS (if applicable)

Example:

```json
"body": "{
  "id": 173
}"
"filename":"s3://bucket/granulename.dat"
"granuleId":"FakeGranule2"
"status": "COMPLETED"
"statusCode": 201
```

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please see our
[contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
