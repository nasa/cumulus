---
id: collection-storage-best-practices
title: Collection Storage Best Practices
hide_title: true
---

# Collection Cost Tracking and Storage Best Practices

Organizing your data is important for metrics you may want to collect. AWS S3 storage and cost metrics are calculated at the bucket level, so it is easy to get metrics by bucket. You can get storage metrics at the key prefix level, but that is done through the CLI, which can be very slow for large buckets. It is very difficult to estimate costs at the prefix level.

## Calculating Storage By Collection

### By bucket

Usage by bucket can be obtained in your [AWS Billing Dashboard](https://console.aws.amazon.com/billing/home) via an [S3 Usage Report](https://docs.aws.amazon.com/AmazonS3/latest/dev/aws-usage-report.html). You can download your usage report for a period of time and review your storage and requests at the bucket level.

Bucket metrics can also be found in the [AWS CloudWatch Metrics Console](https://console.aws.amazon.com/cloudwatch/home#metricsV2:graph=~();namespace=~'AWS*2fS3) (also see [Using Amazon CloudWatch Metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/working_with_metrics.html)).

Navigate to `Storage Metrics` and select the `BucketName` for all buckets you are interested in. The available metrics are `BucketSizeInBytes` and `NumberOfObjects`.

In the `Graphed metrics` tab, you can select the type of statistic (i.e. average, minimum, maximum) and the period for the stats. At the top, it's useful to select from the dropdown to view the metrics as a number. You can also select the time period for which you want to see stats.

Alternatively you can query CloudWatch using the CLI.

This command will return the average number of bytes in the bucket `test-bucket` for 7/31/2019:

```bash
aws cloudwatch get-metric-statistics --namespace AWS/S3 --start-time 2019-07-31T00:00:00 --end-time 2019-08-01T00:00:00 --period 86400 --statistics Average --region us-east-1 --metric-name BucketSizeBytes --dimensions Name=BucketName,Value=test-bucket Name=StorageType,Value=StandardStorage
```

The result looks like:

```json
{
    "Datapoints": [
        {
            "Timestamp": "2019-07-31T00:00:00Z",
            "Average": 150996467959.0,
            "Unit": "Bytes"
        }
    ],
    "Label": "BucketSizeBytes"
}
```

### By key prefix

AWS does not offer storage and usage statistics at a key prefix level. Via the AWS CLI, you can get the total storage for a bucket or folder. The following command would get the storage for folder `example-folder` in bucket `sample-bucket`:

`aws s3 ls --summarize --human-readable --recursive s3://sample-bucket/example-folder | grep 'Total'`

Note that this can be a long-running operation for large buckets.

## Calculating Cost By Collection

### NASA NGAP Environment

If using an NGAP account, the cost per bucket can be found in your CloudTamer console, in the `Financials` section of your account information. This is calculated on a monthly basis.

There is no easy way to get the cost by folder in the buckets. You could calculate an estimate using the storage per prefix vs. the storage of the bucket.

### Outside of NGAP

You can enabled [S3 Cost Allocation Tags](https://docs.aws.amazon.com/AmazonS3/latest/dev/CostAllocTagging.html) and tag your buckets. From there, you can view the cost breakdown in your [AWS Billing Dashboard](https://console.aws.amazon.com/billing/home) via the Cost Explorer. Cost Allocation Tagging is available at the bucket level.

There is no easy way to get the cost by folder in the buckets. You could calculate an estimate using the storage per prefix vs. the storage of the bucket.

## Storage Configuration

Cumulus allows for the configuration of many buckets for your files. Buckets are created and added to your deployment as part of the [deployment process](../deployment/deployment-readme#create-s3-buckets).

In your Cumulus [collection configuration](../data-cookbooks/setup#collections), you specify where you want the files to be stored post-processing. This is done by matching a regular expression on the file with the configured bucket.

Note that in the collection configuration, the `bucket` field is the key to the `buckets` variable in the deployment's `.tfvars` file.

### Organizing By Bucket

You can specify separate groups of buckets for each collection, which could look like the example below.

```json
{
  "name": "MOD09GQ",
  "version": "006",
  "granuleId": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}$",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
  "files": [
    {
      "bucket": "MOD09GQ-006-protected",
      "regex": "^.*\\.hdf$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf"
    },
    {
      "bucket": "MOD09GQ-006-private",
      "regex": "^.*\\.hdf\\.met$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met"
    },
    {
      "bucket": "MOD09GQ-006-protected",
      "regex": "^.*\\.cmr\\.xml$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.cmr.xml"
    },
    {
      "bucket": "MOD09GQ-006-public",
      "regex": "^*\\.jpg$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_ndvi.jpg"
    }
  ]
}
```

Additional collections would go to different buckets.

### Organizing by Key Prefix

Different collections can be organized into different folders in the same bucket, using the key prefix, which is specified as the `url_path` in the collection configuration. In this simplified collection configuration example, the `url_path` field is set at the top level so that all files go to a path prefixed with the collection name and version.

```json
{
  "name": "MOD09GQ",
  "version": "006",
  "granuleId": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}$",
  "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
  "files": [
    {
      "bucket": "protected",
      "regex": "^.*\\.hdf$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf"
    },
    {
      "bucket": "private",
      "regex": "^.*\\.hdf\\.met$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met"
    },
    {
      "bucket": "protected",
      "regex": "^.*\\.cmr\\.xml$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.cmr.xml"
    },
    {
      "bucket": "public",
      "regex": "^*\\.jpg$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_ndvi.jpg"
    }
  ]
}
```

In this case, the path to all the files would be: `MOD09GQ___006/<filename>` in their respective buckets.

The `url_path` can be overidden directly on the file configuration. The example below produces the same result.

```json
{
  "name": "MOD09GQ",
  "version": "006",
  "granuleId": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}$",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
  "files": [
    {
      "bucket": "protected",
      "regex": "^.*\\.hdf$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
      "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}"
    },
    {
      "bucket": "private",
      "regex": "^.*\\.hdf\\.met$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met",
      "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}"
    },
    {
      "bucket": "protected-2",
      "regex": "^.*\\.cmr\\.xml$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.cmr.xml",
      "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}"
    },
    {
      "bucket": "public",
      "regex": "^*\\.jpg$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_ndvi.jpg",
      "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}"
    }
  ]
}
```
