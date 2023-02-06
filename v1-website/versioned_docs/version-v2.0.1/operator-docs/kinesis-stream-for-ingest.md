---
id: version-v2.0.1-kinesis-stream-for-ingest
title: Kinesis Stream For Ingest
hide_title: true
original_id: kinesis-stream-for-ingest
---

# Setup Kinesis Stream & CNM Message

> **Note**: Keep in mind that you should only have to set this up once per ingest stream. Kinesis pricing is based on the shard value and not on amount of kinesis usage.
<!-- markdownlint-disable MD029 -->
1. Create a Kinesis Stream

* In your AWS console, go to the `Kinesis` service and click `Create Data Stream`.
* Assign a name to the stream.
* Apply a `shard value` of `1`.
* Click on `Create Kinesis Stream`.
* A status page with stream details display. Once the status is `active` then the stream is ready to use. Keep in mind to record the streamName and StreamARN for later use.
![Screenshot of AWS console page for creating a Kinesis stream](assets/cnm_create_kinesis_stream.jpg)

2. Create a Rule

* Refer to [Create Rule in Cumulus](../operator-docs/create-rule-in-cumulus).

3. Send a message

* Send a message that makes your schema using python or by your command line.
* The `streamName` and `Collection` must match the `kinesisArn+collection` defined in the rule that you have created in [Step 2](../operator-docs/create-rule-in-cumulus).
<!-- markdownlint-enable MD029 -->