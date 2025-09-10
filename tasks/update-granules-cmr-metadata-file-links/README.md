# @cumulus/update-granules-cmr-metadata-file-links

This Cumulus task component updates CMR metadata files to have correct values for `producerGranuleId` and `granuleIdCMR`, and update all granule URL

* CMR UMMG Metadata is updated with `producerGranuleId` added/updated in `DataGranule.Identifiers` as an array item with the type of `ProducerGranuleId` in the CMR metadata file
* CMR UMMG Metadata is updated with `granuleId` set to `GranuleUR` in the CMR metadata file
* CMR UMMG Metadata updates `OnlineAccessUrls` such that the CMR granule metadata has the correct URL based on the incoming `granule` object and Cumulus bucket configuration
* CMR XML Metadata is updated with `producerGranuleId` set as the value for `Granule.DataGranule.ProducerGranuleId`
* CMR XML Metadata is updated with `granuleId` set as the value for `Granule.GranuleUR`
* CMR XML Metadata updates the `OnlineResources` such that the CMR granule metadata has the correct URL based on the incoming `granule` object and Cumulus bucket configuration

## Input/Output Schema

### Input

```json
{
  "granules": [
    {
      "granuleId": "<granule-id>",
      "files": [
        {
          "bucket": "cumulus-bucket",
          "key": "path/to/file.hdf",
          "filename": "s3://cumulus-bucket/path/to/file.hdf"
        },
        {
          "bucket": "cumulus-bucket",
          "key": "path/to/file.cmr.xml",
          "filename": "s3://cumulus-bucket/path/to/file.cmr.xml"
        }
      ]
    }
  ]
}
```

### Output

```json
{
  "granules": [
    {
      "granuleId": "<granule-id>",
      "files": [
        {
          "bucket": "cumulus-bucket",
          "key": "path/to/file.hdf",
          "filename": "s3://cumulus-bucket/path/to/file.hdf"
        },
        {
          "bucket": "cumulus-bucket",
          "key": "path/to/file.cmr.xml",
          "filename": "s3://cumulus-bucket/path/to/file.cmr.xml"
        }
      ]
    }
  ]
}
```

The task updates the URLs in the CMR metadata files but returns the same granules object structure that was provided as input.    The CMR file metadata (e.g. size) is updated to reflect any modifications made, as needed.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)


## Contributing

Please refer to: https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md
