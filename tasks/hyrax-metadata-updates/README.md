# @cumulus/hyrax-metadata-updates

## Description

This lambda function is responsible for augmenting granule metadata files with the correct Hyrax (OPeNDAP) URL to provide subsetting and reformatting services on your granules. The URL will convey enough information to Hyrax to discover the granule using CMR. Hyrax will then determine the archive location within Cumulus from the granule's metadata.

For example, the Hyrax URL for a granule with short name `GLDAS_CLSM025_DA1_D` and version `2.2` from collection ID `C1233603862-GES_DISC` and granule UR `GLDAS_CLSM025_DA1_D.2.2:GLDAS_CLSM025_DA1_D.A20030204.022.nc4`:

h<span>ttps://opendap.uat.earthdata.nasa.gov/collections/**C1233603862-GES_DISC**/**GLDAS_CLSM025_DA1_D**.**2.2**/granules/**GLDAS_CLSM025_DA1_D.2.2:GLDAS_CLSM025_DA1_D.A20030204.022.nc4**

/UMM-C:{ShortName}.UMM-C:{Version} between "collections" and "granules" is optional and could be included using `addShortnameAndVersionIdToConceptId: true` in config.json. By default, it is `false`.

This url will be added to the Urls portion of the granule metadata as follows,

### UMM-G example

```json
"RelatedUrls": [
    ...
    {
        "URL": "opendap.uat.earthdata.nasa.gov/collections/C1233603862-GES_DISC/GLDAS_CLSM025_DA1_D.2.2/granules/GLDAS_CLSM025_DA1_D.2.2:GLDAS_CLSM025_DA1_D.A20030204.022.nc4",
        "Type": "USE SERVICE API",
        "Subtype": "OPENDAP DATA",
        "Description": "OPeNDAP request URL"
    }
]
```

### ECHO-10 example

```json
<OnlineResources>
    ...
    <OnlineResource>
        <URL>https://opendap.uat.earthdata.nasa.gov/collections/C1233603862-GES_DISC/GLDAS_CLSM025_DA1_D.2.2/granules/GLDAS_CLSM025_DA1_D.2.2:GLDAS_CLSM025_DA1_D.A20030204.022.nc4</URL>
        <Description>OPeNDAP request URL</Description>
        <Type>GET DATA : OPENDAP DATA</Type>
    </OnlineResource>
</OnlineResources>
```
The four properties we need to construct this url are as follows,
| Property      | Source                              | Notes
| ------------- | ----------------------------------- | -----
| Provider ID   | Configuration `config.cmr.provider` |
| Collection ID | Derived from retrieval of parent collection from CMR | This requires a call to the CMR search API
| ShortName     | --//--                              | optional
| Version       | --//--                              | optional
| Granule UR    | Granule metadata:  <br>UMM-G `GranuleUR`  <br>ECHO10 `Granule->GranuleUR`
| Environment   | `process.env.CMR_ENVIRONMENT`       | Specifies the environment of Hyrax (e.g. `SIT`, `UAT`, `PROD`)



For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name            | type    | default    | description
| --------------------- | ------- | ---------- | -----------
| bucket                | string  | (required) | Name of S3 bucket containing public/private key pair to decrypt CMR credentials
| stack                 | string  | (required) | Name of deployment stack
| cmr                   | object  | (required) | CMR credentials object
| addShortnameAndVersionIdToConceptId | boolean | false | Option to humanize the Hyrax URL. Humanizes when set to true.
| skipMetadataValidation | boolean | false | Option to skip metadata validation

### Input

Input object fields:

| field name | type            | default    | description
| ---------- | ----            | -------    | -----------
| granules   | array\<object\> | (required) | List of granule objects

### Output

Output object fields:

| field name | type            | default  | description
| ---------- | ----            | -------  | -----------
| granules   | array\<object\> | N/A      | List of granule objects

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
