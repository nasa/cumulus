---
id: workflow-configuration-how-to
title: Workflow Configuration How To's
hide_title: true
---

# Workflow Configuration How To's

## How to specify a bucket for granules

How to configure `.yml` workflow configuration in `workflows` directory for specifying buckets.

### Bucket configuration

Buckets configured in `app/config.yml` will ultimately become part of the workflow configuration.`type` of a bucket relies on the how that bucket will be used.
`public` indicates a completely public bucket.
`internal` type is for system use.
`protected` buckets are for any information that should be behind an Earthdata Login authentication.
`private` buckets are for private data.

Consider this `app/config.yml` for all following examples:

```
buckets:
  internal:
    name: sample-internal-bucket
    type: internal
  private:
    name: sample-private-bucket
    type: private
  protected:
    name: sample-protected-bucket
    type: protected
  public:
    name: sample-public-bucket
    type: public
  protected-2:
    name: sample-protected-bucket-2
    type: protected
```

### Point to buckets in the workflow configuration

Buckets specified in `app/config.yml` will become part of the `meta` object of the Cumulus message and can be accessed in your workflow configuration.

To use the buckets specified in your config, you can do the following:

```
DiscoverGranules:
      CumulusConfig:
        provider: '{$.meta.provider}'
        collection: '{$.meta.collection}'
        buckets: '{$.meta.buckets}'
```

```
MoveGranules:
      CumulusConfig:
        bucket: '{$.meta.buckets.internal.name}'
        buckets: '{$.meta.buckets}'
```

### Hardcode a bucket

Bucket names can be hardcoded in your workflow configuration, for example:

```
DiscoverGranules:
      CumulusConfig:
        provider: '{$.meta.provider}'
        collection: '{$.meta.collection}'
        buckets:
          internal: 'sample-internal-bucket'
          protected: 'sample-protected-bucket-2'
```
Or you can do a combination of meta buckets and hardcoded:

```
DiscoverGranules:
      CumulusConfig:
        provider: '{$.meta.provider}'
        collection: '{$.meta.collection}'
        buckets:
          internal: 'sample-internal-bucket'
          private: '{$.meta.buckets.private.name}'
```

### Using meta and hardcoding

Bucket names can be configured using a mixture of hardcoded values and values from the meta. For example, to configure the bucket based on the collection name you could do something like:

```
DiscoverGranules:
      CumulusConfig:
        provider: '{$.meta.provider}'
        collection: '{$.meta.collection}'
        buckets:
          internal: '{$.meta.collection.name}-bucket'
```
## How to specify a file location in a bucket

Granule files can be placed in folders and subfolders in buckets for better organization. This is done by setting a `url_path` in the base level of a collection configuration to be applied to all files. To only affect placement of a single file, the `url_path` variable can be placed in that specific file of the collection configuration. There are a number of different ways to populate `url_path`.

### Hardcoding file placement

A file path can be added as the `url_path` in the collection configuration to specify the final location of the files. For example, take the following collection configuration

```
{
  "name": "MOD09GQ",
  "version": "006",
  "url_path": "example-path",
  "files": {
    {
      "bucket": "protected",
      "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.hdf$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
      "url_path": "file-example-path"
    },
    {
      "bucket": "private",
      "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.hdf\\.met$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met"
    }
  }
}
```

The first file, `MOD09GQ.A2017025.h21v00.006.2017034065104.hdf` has its own `url_path` so the resulting file path might look like `s3://sample-protected-bucket/file-example-path/MOD09GQ.A2017025.h21v00.006.2017034065104.hdf`.
The second file, `MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met`, does not have it's own `url_path` so it will use the collection `url_path` and have a final file path of `s3://sample-private-bucket/example-path/MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met`.

### Using a template for file placement

Instead of hardcoding the placement, the `url_path` can be a template to be populated with metadata during the move-granules step. For example:

```
"url_path": "{cmrMetadata.Granule.Collection.ShortName}"
```

This url path with be assigned as the collection shortname, `"MOD09GQ"`.
To take a subset of any given metadata, use the option `substring`.

```
"url_path": "{cmrMetadata.Granule.Collection.ShortName}/{substring(file.fileName, 0, 3)}"
```

This example will populate to `"MOD09GQ/MOD"`

Note: the move-granules step needs to be in the workflow for this template to be populated and the file moved. This `cmrMetadata` or CMR granule XML needs to have been generated and stored on S3. From there any field could be retrieved and used for a url_path.

### Adding Metadata dates and times to the URL Path

There are a number of options to pull dates from the CMR file metadata. With this metadata:

```
<Granule>
    <Temporal>
        <RangeDateTime>
            <BeginningDateTime>2003-02-19T00:00:00Z</BeginningDateTime>
            <EndingDateTime>2003-02-19T23:59:59Z</EndingDateTime>
        </RangeDateTime>
    </Temporal>
</Granule>
```

The following examples of `url_path` could be used.

`{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}` will pull the year from the full date: `2003`.

`{extractMonth(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}` will pull the month: `2`.

`{extractDate(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}` will pull the day: `19`.

`{extractHour(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}` will pull the hour: `0`.

Different values can be combined to create the `url_path`. For example

```
"bucket": "sample-protected-bucket",
"name": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
"url_path": "{cmrMetadata.Granule.Collection.ShortName}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)/extractDate(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}"

```

The final file location for the above would be `s3://sample-protected-bucket/MOD09GQ/2003/19/MOD09GQ.A2017025.h21v00.006.2017034065104.hdf`.
