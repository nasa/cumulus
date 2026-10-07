---
id: kinesis-stream-for-ingest
title: Setup Kinesis Stream & CNM Message
hide_title: false
---

:::tip

Keep in mind that you should only have to set this up once per ingest stream. Kinesis pricing is based on the shard value and not on amount of kinesis usage.

:::

1. Create a Kinesis Stream

    - In your AWS console, go to the `Kinesis` service and click `Create Data Stream`.
    - Assign a name to the stream.
    - Select `Provisioned` capacity mode
        - Alternatively select `On-Demand` depending on your needs and [cost analysis](https://aws.amazon.com/kinesis/data-streams/pricing/)
    - Apply a `shard value` of `1`.
    - Click on `Create Data Stream`. A status page with stream details will display.
    - Click on `Configuration` and then `Edit` next to `Encryption`
    - Check the `Enable server-side encryption` checkbox and click `Save Changes`
        - Using the default AWS managed CMK is recommended
    - Once the status is `active` the stream is ready to use. Record the streamName and StreamARN for later use.

2. Create a Rule

    - Refer to [Create Rule in Cumulus](../operator-docs/create-rule-in-cumulus).

3. Send a message

    - Send a message that makes your schema using python or by your command line.
    - The `streamName` and `Collection` must match the `kinesisArn+collection` defined in the rule that you have created in [Step 2](../operator-docs/create-rule-in-cumulus).
