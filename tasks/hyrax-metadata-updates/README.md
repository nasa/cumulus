# @cumulus/hyrax-metadata-updates

## Description

This lambda function is responsible for augmenting granule metadata files with the correct Hyrax (OPeNDAP) URL to provide subsetting and reformatting services on your granules. The URL will convey enough information to Hyrax to discover the granule using CMR. It will then determine the archive location within Cumulus from the granule's metadata.
For example,

Hyrax URL for a granule from provider 'GHRC_CLOUD' and collection entry title 'ACES CONTINUOUS DATA V1' with native id 'aces1cont_2002.191_v2.50.nc':

h<span>ttps://opendap.earthdata.nasa.gov/providers/**GHRC_CLOUD**/datasets/**ACES CONTINUOUS DATA V1**/granules/**aces1cont_2002.191_v2.50.nc**

This url will be added to the Urls portion of the granule metadata as follows,

### UMM-G example

```
"RelatedUrls": [
    ...
    {
        "URL": "https://opendap.earthdata.nasa.gov/providers/GHRC_CLOUD/datasets/ACES CONTINUOUS DATA V1/granules/aces1cont_2002.191_v2.50.nc",
        "Type": "GET DATA",
        "Subtype": "OPENDAP DATA",
        "Description": "OPeNDAP request URL"
    }
]
```

### ECHO-10 example

```
<OnlineResources>
    ...
    <OnlineResource>
        <URL>https://opendap.earthdata.nasa.gov/providers/GHRC_CLOUD/datasets/ACES CONTINUOUS DATA V1/granules/aces1cont_2002.191_v2.50.nc</URL>
        <Description>OPeNDAP request URL</Description>
        <Type>GET DATA : OPENDAP DATA</Type>
    </OnlineResource>
</OnlineResources>
```
The four properties we need to construct this url are as follows,
| Property | Source | Notes
| -------- | ------ | -----
| Provider ID | Granule metadata:  <br>UMM-G `meta->provider-id`  <br>ECHO10 ? | Should we get this by querying CMR?
| Entry Title | Configuration | Should we get this by querying CMR?
| Native ID   | Granule metadata:  <br>UMM-G `meta->native-id`  <br>ECHO10 `Granule->DataGranule->ProducerGranuleId`
| Environment | Configuration | Do we wish to use the SIT, UAT or PROD version of Hyrax?


For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name            | type    | default    | values         | description
| --------------------- | ------- | ---------- | -------------- | -----------
| bucket                | string  | (required) |                | Bucket with public/private key for decrypting CMR password
| buckets               | object  | (required) |                | Object specifying AWS S3 buckets used by this task
| collection            | object  | (required) |                | The cumulus-api collection object
| entry_title           | string  | (required) |                | The CMR entry title for this collection
| provider              | string  | (required) |                | The CMR provider ID associated with this archive
| environment           | string  |            | `sit|uat|prod` | The Hyrax environment you wish to interact with. If not present, then `prod` is assumed
| duplicateHandling     | string  | `error`    | <ul><li>`error` - Throws an error on duplicates</li><li>`replace` - Replaces the existing file</li><li>`skip` - Skips the duplicate file</li><li>`version` - Adds a suffix to the existing filename to avoid a clash</li></ul> | Specifies how duplicate filenames should be handled

### Input

Input object fields:

| field name | type            | default    | description
| ---------- | ----            | -------    | -----------
| granules   | array\<object\> | (required) | List of granule objects

### Output

Output object fields:

| field name | type            | default  | description
| ---------- | ----            | -------  | -----------
| granules   | array\<object\> | N/A      | List of granule objects with updated S3 location information

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).