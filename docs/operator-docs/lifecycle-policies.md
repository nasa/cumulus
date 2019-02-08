---
id: lifecycle-policies
title: Lifecycle Policies
hide_title: true
---

# Setting Lifecycle Policies

This document will outline, in brief, how to set data lifecycle policies so that you are more easily able to control data storage costs while keeping your data accessible.

## Requirements

* An AWS user with the appropriate roles to access the target bucket as well as modify bucket policies.
* To use the command line examples on this page you will need to have the AWS CLI installed and configured.  See [AWS's guide to setting up the AWS CLI](https://docs.aws.amazon.com/AmazonS3/latest/dev/setup-aws-cli.html) for more on this.   Please ensure the AWS CLI is in your shell path.
* You will need a S3 bucket on AWS.   ***You are strongly encouraged to use a bucket without voluminous amounts of data in it for experimenting/learning***.

## Background Information

This section lists information you may want prior to working through this example, however it is not required to read through this.

### Strategy Overview

For a discussion of overall recommended strategy, please review the [Methodology for Data Lifecycle Management](https://wiki.earthdata.nasa.gov/display/CUMULUS/Methodology+for+Data+Lifecycle+Management) on the EarthData wiki.

### AWS Documentation

* [AWS's guide to setting up the AWS CLI](https://docs.aws.amazon.com/AmazonS3/latest/dev/setup-aws-cli.html)
* [AWS's guide on setting bucket lifecycle policies via the management Console](https://docs.aws.amazon.com/AmazonS3/latest/user-guide/create-lifecycle.html)
* [AWS's guide on setting bucket lifecycle policies using the AWS CLI](https://docs.aws.amazon.com/AmazonS3/latest/dev/set-lifecycle-cli.html)
* [AWS's guide to lifecycle configuration](https://docs.aws.amazon.com/AmazonS3/latest/dev/lifecycle-configuration-examples.html)

## Examples
### Walkthrough on setting time-based S3IA bucket policy
This example will give step-by-step instructions on updating a bucket's lifecycle policy to move all objects in the bucket from the default storage (Standard) to S3IA after a period of 90 days.   Below are instructions for walking through configuration via the command line and the management console.

#### Command Line
**Please ensure you have the AWS CLI installed and configured for access prior to attempting this example.**

##### Create policy
From any directory you chose, open an editor and add the following to a file named `exampleRule.json`

```
{
    "Rules": [
        {
          "Status": "Enabled",
          "Filter": {
            "Prefix": ""
          },
          "Transitions": [
            {
              "Days": 90,
              "StorageClass": "STANDARD_IA"
            }
          ],
          "ID": "90DayS3IAExample"
        }
    ]
}
```

##### Set policy

On the command line run the following command (with the bucket you're working with substituted in place of yourBucketNameHere).

```
aws s3api put-bucket-lifecycle-configuration --bucket yourBucketNameHere --lifecycle-configuration file://exampleRule.json
```

This will set a policy that transitions any version of an object in the bucket to S3IA after each object has not been modified for 90 days.

##### Verify policy has been set

To obtain all of the existing policies for a bucket, run the following command (again substituting the correct bucket name):

```
 aws s3api get-bucket-lifecycle-configuration --bucket yourBucketNameHere
```

This should output:
```
{
    "Rules": [
        {
            "ID": "90DayS3IAExample",
            "Filter": {
                "Prefix": ""
            },
            "Status": "Enabled",
            "Transitions": [
                {
                    "Days": 90,
                    "StorageClass": "STANDARD_IA"
                }
            ]
        }
    ]
}
```

#### Management Console

##### Create Policy

To create the example policy on a bucket via the management console, go to the following URL (replacing 'yourBucketHere' with the bucket you intend to update):


```
https://s3.console.aws.amazon.com/s3/buckets/yourBucketHere/?tab=overview
```

You should see a screen similar to:

aws_bucket_console_example.png

Click the "Management" Tab, then lifecycle button and press `+ add lifecycle rule`:

add_lifecycle_rule.png

Give the rule a name (e.g. '90DayRule'), leaving the filter blank:

lifecycle_1.png

Click `next`, and mark `Current Version` and `Previous Versions`.

Then for each, click `+ Add transition` and select `Transition to Standard-IA after` for the `Object creation` field, and set `90` for the `Days after creation`/`Days after objects become concurrent` field.    Your screen should look similar to:

lifecycle_2.png

Click `next`, then next past the `Configure expiration` screen (we won't be setting this), and on the fourth page, click `Save`:

lifecycle_4.png

You should now see you have a rule configured for your bucket:

lifecycle_5.png

You have now set a policy that transitions any version of an object in the bucket to S3IA after each object has not been modified for 90 days.
