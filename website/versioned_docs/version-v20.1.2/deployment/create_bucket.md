---
id: create_bucket
title: Creating an S3 Bucket
hide_title: false
---

Buckets can be created on the command line with [AWS CLI][cli] or via the web interface on the [AWS console][web].

When creating a protected bucket (a bucket containing data which will be served through the distribution API), make sure to enable S3 server access logging. See [S3 Server Access Logging](../configuration/server_access_logging.md) for more details.

## Command Line

Using the [AWS Command Line Tool][cli] [create-bucket](https://docs.aws.amazon.com/cli/latest/reference/s3api/create-bucket.html) ``s3api`` subcommand:

```bash
$ aws s3api create-bucket \
    --bucket foobar-internal \
    --region us-west-2 \
    --create-bucket-configuration LocationConstraint=us-west-2
{
    "Location": "/foobar-internal"
}
```

:::info

The `region` and `create-bucket-configuration` arguments are only necessary if you are creating a bucket outside of the `us-east-1` region.

:::

Please note security settings and other bucket options can be set via the options listed in the ``s3api`` documentation.

Repeat the above step for each bucket to be created.

## Web Interface

If you prefer to use the AWS web interface instead of the command line, see [AWS "Creating a Bucket" documentation][web].

[cli]: https://aws.amazon.com/cli/ "Amazon Command Line Interface"
[web]: http://docs.aws.amazon.com/AmazonS3/latest/gsg/CreatingABucket.html "Amazon web console interface"
