# @cumulus/update-granules-cmr-metadata-file-links

This Cumulus task component updates CMR metadata files to have correct values for `producerGranuleId` and `granuleIdCMR`, and update all granule URL

* CMR UMMG Metadata is updated with `producerGranuleId` added/updated in `DataGranule.Identifiers` as an array item with the type of `ProducerGranuleId` in the CMR metadata file, `DataGranule.DayNightFlag` and `DataGranule.ProductionDateTime` will also be populated if they are not already
* CMR UMMG Metadata is updated with `granuleId` set to `GranuleUR` in the CMR metadata file
* CMR UMMG Metadata updates `OnlineAccessUrls` such that the CMR granule metadata has the correct URL based on the incoming `granule` object and Cumulus bucket configuration
* CMR XML Metadata is updated with `producerGranuleId` set as the value for `Granule.DataGranule.ProducerGranuleId`
* CMR XML Metadata is updated with `granuleId` set as the value for `Granule.GranuleUR`
* CMR XML Metadata updates the `OnlineResources` such that the CMR granule metadata has the correct URL based on the incoming `granule` object and Cumulus bucket configuration

**Note** As default behavior for this task, for UMMG and ECHO10 granules, a `Granule.DataGranule` section will be added if not already present within the metadata. For UMMG granules (as of `CSD-85`), the required fields ([as seen here](https://git.earthdata.nasa.gov/projects/EMFD/repos/unified-metadata-model/browse/granule/v1.6.6/umm-g-json-schema.json#257)) of `ProductionDateTime` and `DayNightFlag` will be populated with default values (the time the task is ran for `ProductionDateTime` and `Unspecified` for `DayNightFlag`) if they are not already included, along with the other updates described above. For ECHO10 granules, the required field for DataGranules, `ProducerGranuleId` ([as seen here](https://git.earthdata.nasa.gov/projects/EMFD/repos/echo-schemas/browse/schemas/10.0/Granule.xsd#409)), will be populated, along with the other updates described above. To disable adding/updating the granule's metadata in this task for both ECHO10 and UMMG granules, set `excludeDataGranule` as `true` (boolean, not a string) (added as part of `CSD-85`) in the task config schema. If set to `true` this task will not change anything relating to the `Granule.DataGranule` in the granule's metadata, no adding or updating.

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
