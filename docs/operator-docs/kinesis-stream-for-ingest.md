---
id: kinesis-stream-for-ingest
title: Kinesis Stream For Ingest
hide_title: true
---

# Setup Kinesis Stream & CNM Message

> **Note**: Keep in mind that you should only have to set this up once. This should be created via the SDS or from a cloud formation template. Kinesis pricing is based on the shard value and not on amount of kinesis usage.

1. Create a Kinesis Stream

  * Go to the `Kinesis` service and click `Create Data Stream`.
  * Assign a name to the stream.
  * Apply a `shard value` of `1`.
  * Click on `Create Kinesis Stream`.
  * A status page with stream details display. Once the status is `active` then the stream is ready to use. Keep in mind to record the streamName and StreamARN for later use.

2. Create a Rule

  * Refer to [Create Rule in Cumulus](../operator-docs/create-rule-in-cumulus).

3. Send a CNM Message

  * Send a message using python.
  * The `streamName` and `Collection` must match the `kinesisArn+collection` defined in the rule that you have created in [Step 2](../operator-docs/create-rule-in-cumulus).