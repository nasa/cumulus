# @cumulus/lzards-backup

This is a [Cumulus](https://nasa.github.io/cumulus) task which will take a list of Cumulus granule objects and based on granule collection configuration make requests to the configured LZARDS API for backup as appropriate.

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see
[the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

This task has two optional configuration fields, reflecting the options for passing an access URL to the LZARDS API.
Conformant to the included `config.json` schema, these are:

| field name            | type    | default    | description
| --------------------- | ------- | ---------- | -----------
| urlType               | string  | 's3'       | urlType to generate and pass to LZARDS. Accepted values are 's3' and 'cloudfront'.
| cloudfrontEndpoint    | string  | N/A        | cloudfront endpoint URL, required if urlType is 'cloudfront'
| failTaskWhenFileBackupFail  | boolean  | false  | Indicates if the task will fail when file backup request fails
| lzardsProvider | string | Cumulus Core terraform module `lzards_provider` variable | Value to submit to LZARDS for `provider`

### Input

Example:

The following shows two examples of the minimal set of keys required for an input payload:

```json
{
  "granules": [
    {
      "granuleId": "FakeGranule001",
      "dataType": "FakeGranuleType",
      "version": "006",
      "provider": "FakeProvider",
      "createdAt": 1647222436211,
      "files": [
        {
          "bucket": "fakeBucket",
          "key": "fakeKey",
          "checksumType": "md5",
          "checksum": "someChecksum"
        },
        {
          "bucket": "fakeBucket",
          "key": "fakeKey",
          "checksumType": "md5",
          "checksum": "someChecksum"
        },
      ]
    }
  ]
}
```

```json
{
  "granules": [
    {
      "granuleId": "FakeGranule001",
      "collectionId": "FakeGranuleType___006",
      "files": [
        {
          "bucket": "fakeBucket",
          "key": "fakeKey",
          "checksumType": "md5",
          "checksum": "someChecksum"
        },
        {
          "bucket": "fakeBucket",
          "key": "fakeKey",
          "checksumType": "md5",
          "checksum": "someChecksum"
        },
      ]
    }
  ]
}
```

See the full schema here: [LZARDS backup input schema](https://github.com/nasa/cumulus/blob/master/tasks/lzards-backup/schemas/input.json)

Each granule *must* have a [`dataType` and `version`] OR `collectionId` to associate it with a Cumulus collection.

In addition to the task schema requirements, any granule files that are to be backed up *must* have a `checksumType` (md5 | sha256 | sha512) with a value for `checksum` as LZARDS requires a checksum value.

For a granule file to be backed up, the following should be added to the Collection file configuration for that filetype:

```json
{ "lzards": { "backup": true } }
```

### Output

The task output will contain the results of the requests to LZARDS.   Please note that this task does *not* halt waiting for a response from LZARDS, and *does not* fail if LZARDS rejects an individual backup request.    The task *will* throw if there is an error thrown unrelated to a LZARDS API call, but attempt to make all requests before it does so.

Upon completion the lambda will return the following structure:

```json
{
  "granules": "<Object containing the input granules>",
  "backupResults": "<Object containing the backup request results>"
}
```

`granules` is an output object containing the contents of `input.granules` and can be remapped to the payload output or elsewhere if so desired.

`backupResults` is an object array that contains:

- `body`       : body returned from the LZARDS API query
- `filename`   : original s3 URI to the archived file
- `granuleId`  : granuleId associated with the archival request
- `provider`   : provider associated with the archival request
- `createdAt`  : granule createdAt associated with the archival request
- `status`     : 'status' of the request.   Will either be COMPLETED or FAILED
- `statusCode` : status code returned from LZARDS (if applicable)

Example:

```json
"body": "{
  "id": 173
}"
"filename":"s3://bucket/granulename.dat",
"granuleId":"FakeGranule2",
"provider": "FakeProvider",
"createdAt": 1647222436211,
"status": "COMPLETED",
"statusCode": 201
```

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please see our
[contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
