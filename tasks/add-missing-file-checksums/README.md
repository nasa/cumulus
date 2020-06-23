# @cumulus/add-missing-file-checksums

This is a [Cumulus](https://nasa.github.io/cumulus) task which will find granule
files without `checksumType` and `checksum` set and populate those fields based
on the calculated hash of the S3 object.

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see
[the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

There is only one config field expected, which is `algorithm`. Allowed values
are either `cksum`, or an algorithm listed in `openssl list -digest-algorithms`.

### Input

Example input:

```json
{
  "granules": [
    {
      "files": [
        {
          "filename": "s3://bucket/file/with/checksum.dat",
          "checksumType": "md5",
          "checksum": "asdfdsa"
        },
        {
          "filename": "s3://bucket/file/without/checksum.dat",
        }
      ]
    }
  ]
}
```

The `filename` property is used to determine the location of the S3 object to
use when calculating the checksum.

### Output

The output will be the same as the input, but with `checksumType` and `checksum`
added to files where it was missing.

Files which already contain `checksumType` or `checksum` will not be updated.

Files which do not contain a `filename` property will not be updated.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please see our
[contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
