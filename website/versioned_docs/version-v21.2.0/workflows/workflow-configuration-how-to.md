---
id: workflow-configuration-how-to
title: Workflow Configuration How To's
hide_title: false
---

## How to specify a bucket for granules

### Bucket configuration

Buckets configured in your deployment for the `cumulus` module's inputs will
ultimately become part of the workflow configuration. The `type` property of a
bucket describes how that bucket will be used:

* `public` indicates a completely public bucket.
* `internal` type is for Cumulus system use.
* `protected` buckets are for any information that should be behind either
  Earthdata Login (if using TEA for distribution) or Cognito authentication (if
  using the Cumulus Distribution API for distribution)
* `private` buckets are for private data.
* Any other type is allowed and the bucket will be configured with limited IAM
   privileges used by your system but not directly related to your ingest and
   distribution.  For example, your glacier backup bucket could have a type
   `orca` or `recovery` and it would be accessible to Cumulus but not part
   of the ingest/distrubution system.

Consider the following `buckets` configuration variable for the `cumulus`
module for all following examples:

```tcl
buckets =  {
  internal = {
    name = "sample-internal-bucket",
    type = "internal"
  },
  private = {
    name = "sample-private-bucket",
    type = "private"
  },
  protected = {
    name = "sample-protected-bucket",
    type = "protected"
  },
  public = {
    name = "sample-public-bucket",
    type = "public"
  },
  protected-2 = {
    name = "sample-protected-bucket-2",
    type = "protected"
  },
  dashboard = {
    name = "dashboard-bucket",
    type = "dashboard"
  },
  glacier = {
     name = "glacier-backup-bucket",
     type = "orca"
  }
}
```

### Point to buckets in the workflow configuration

Buckets specified in the `buckets` input variable to the [`cumulus` module](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus) will be available in the `meta` object of the Cumulus message.

To use the buckets specified in the configuration, you can do the following:

```json
{
  "DiscoverGranules": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "task_config": {
          "provider": "{$.meta.provider}",
          "provider_path": "{$.meta.provider_path}",
          "collection": "{$.meta.collection}",
          "buckets": "{$.meta.buckets}"
        }
      }
    }
  }
}
```

Or, to map a specific bucket to a config value for a task:

```json
{
  "MoveGranules": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "task_config": {
          "bucket": "{$.meta.buckets.internal.name}",
          "buckets": "{$.meta.buckets}"
        }
      }
    }
  }
}
```

### Hardcode a bucket

Bucket names can be hardcoded in your workflow configuration, for example:

```json
{
  "DiscoverGranules": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "task_config": {
          "provider": "{$.meta.provider}",
          "provider_path": "{$.meta.provider_path}",
          "collection": "{$.meta.collection}",
          "buckets": {
            "internal": "sample-internal-bucket",
            "protected": "sample-protected-bucket-2"
          }
        }
      }
    }
  }
}
```

Or you can do a combination of meta buckets and hardcoded:

```json
{
  "DiscoverGranules": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "task_config": {
          "provider": "{$.meta.provider}",
          "provider_path": "{$.meta.provider_path}",
          "collection": "{$.meta.collection}",
          "buckets": {
            "internal": "sample-internal-bucket",
            "private": "{$.meta.buckets.private.name}"
          }
        }
      }
    }
  }
}
```

### Using meta and hardcoding

Bucket names can be configured using a mixture of hardcoded values and values from the meta. For example, to configure the bucket based on the collection name you could do something like:

```json
{
  "DiscoverGranules": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "task_config": {
          "provider": "{$.meta.provider}",
          "provider_path": "{$.meta.provider_path}",
          "collection": "{$.meta.collection}",
          "buckets": {
            "internal": "{$.meta.collection.name}-bucket"
          }
        }
      }
    }
  }
}
```

## How to specify a file location in a bucket

Granule files can be placed in folders and subfolders in buckets for better organization. This is done by setting a `url_path` in the base level of a collection configuration to be applied to all files. To only affect placement of a single file, the `url_path` variable can be placed in that specific file of the collection configuration. There are a number of different ways to populate `url_path`.

### Hardcoding file placement

A file path can be added as the `url_path` in the collection configuration to specify the final location of the files. For example, take the following collection configuration

```json
{
  "name": "MOD09GQ",
  "version": "006",
  "url_path": "example-path",
  "files": [
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
  ]
}
```

The first file, `MOD09GQ.A2017025.h21v00.006.2017034065104.hdf` has its own `url_path` so the resulting file path might look like `s3://sample-protected-bucket/file-example-path/MOD09GQ.A2017025.h21v00.006.2017034065104.hdf`.
The second file, `MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met`, does not have it's own `url_path` so it will use the collection `url_path` and have a final file path of `s3://sample-private-bucket/example-path/MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met`.

### Using a template for file placement

Instead of hardcoding the placement, the `url_path` can be a template to be populated with metadata during the move-granules step. For example:

```json
"url_path": "{cmrMetadata.Granule.Collection.ShortName}"
```

This url path with be assigned as the collection shortname, `"MOD09GQ"`.
To take a subset of any given metadata, use the option `substring`.

```json
"url_path": "{cmrMetadata.Granule.Collection.ShortName}/{substring(file.fileName, 0, 3)}"
```

This example will populate to `"MOD09GQ/MOD"`

In addition to `substring`, several datetime-specific functions are available, which can parse a datetime string in the metadata and extract a certain part of it:

```json
"url_path": "{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}"
```

or

```json
 "url_path": "{dateFormat(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime, YYYY-MM-DD[T]HH[:]mm[:]ss)}"
```

The following functions are implemented:

* `extractYear` - returns the year, formatted as YYYY
* `extractMonth` - returns the month, formatted as MM
* `extractDate` - returns the day of the month, formatted as DD
* `extractHour` - returns the hour in 24-hour format, with no leading zero
* `extractPath` - returns the path only, not including the file name e.g.`/data/test/abc.xml` returns `/data/test`
* `substring` - returns a portion of the string argument determined by start and end character number arguments
* `dateFormat` - takes a second argument describing how to format the date, and
  passes the metadata date string and the format argument to
  [moment().format()](https://momentjs.com/docs/#/displaying/format/)
* `defaultTo` - takes two arguments and returns the first defined (not `null` or `undefined`) value

:::note

Multiple functions can be nested. For example, `'{extractPath({substring(file.source, 6)})}'` would operate as expected.

:::

:::note

The 'move-granules' step needs to be in the workflow for this template to be populated and the file moved. This `cmrMetadata` or CMR granule XML needs to have been generated and stored on S3. From there any field could be retrieved and used for a url_path.

:::

### Adding Metadata dates and times to the URL Path

There are a number of options to pull dates from the CMR file metadata. With this metadata:

```xml
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

```json
{
"bucket": "sample-protected-bucket",
"name": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
"url_path": "{cmrMetadata.Granule.Collection.ShortName}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)/extractDate(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}"
}
```

The final file location for the above would be `s3://sample-protected-bucket/MOD09GQ/2003/19/MOD09GQ.A2017025.h21v00.006.2017034065104.hdf`.
