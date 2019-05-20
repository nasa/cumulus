---
id: version-v1.13.0-cnm-workflow
title: CNM Workflow
hide_title: true
original_id: cnm-workflow
---

# CNM Workflow

This entry documents how to setup a workflow that utilizes the built-in CNM/Kinesis functionality in Cumulus.

Prior to working through this entry you should be familiar with the [Cloud Notification Mechanism](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cloud+Notification+Mechanism).

## Sections:

* [Prerequisites](#prerequisites)
* [Configure the Workflow](#configure-the-workflow)
* [Execute the Workflow](#execute-the-workflow)
* [Verify Results](#verify-results)
* [Kinesis Record Error Handling](#kinesis-record-error-handling)

------------
## Prerequisites

#### Cumulus

This entry assumes you have a deployed instance of Cumulus (>= version 1.8).

#### AWS CLI

This entry assumes you have the [AWS CLI](https://aws.amazon.com/cli/) installed and configured. If you do not, please take a moment to review the documentation - particularly the [examples relevant to Kinesis](https://docs.aws.amazon.com/streams/latest/dev/fundamental-stream.html) - and install it now.

#### Kinesis

This entry assumes you already have two [Kinesis](https://aws.amazon.com/kinesis/) data steams created for use as CNM notification and response data streams.

If you do not have two streams setup, please take a moment to review the [Kinesis documentation](https://aws.amazon.com/documentation/kinesis/) and setup two basic single-shard streams for this example:

Using the "Create Data Stream" button on the [Kinesis Dashboard](https://console.aws.amazon.com/kinesis/home), work through the dialogue.

You should be able to quickly use the "Create Data Stream" button on the [Kinesis Dashboard](https://console.aws.amazon.com/kinesis/home), and setup streams that are similar to the following example:

![](assets/cnm_create_kinesis_stream.jpg)

Please bear in mind that your `{{prefix}}-lambda-processing` IAM role will need permissions to write to the response stream for this workflow to succeed if you create the Kinesis stream with a dashboard user.   If you are using the example deployment (or a deployment based on it), the IAM permissions should be set properly.

If not, the most straightforward approach is to attach the `AmazonKinesisFullAccess` policy for the stream resource to whatever role your lambdas are using, however your environment/security policies may require an approach specific to your deployment environment.

In operational environments it's likely science data providers would typically be responsible for providing a Kinesis stream with the appropriate permissions.

For more information on how this process works and how to develop a process that will add records to a stream, read the [Kinesis documentation](https://aws.amazon.com/documentation/kinesis/) and the [developer guide](https://docs.aws.amazon.com/streams/latest/dev/introduction.html).

#### Source Data

This entry will run the SyncGranule task against a single target data file.  To that end it will require a single data file to be present in an S3 bucket matching the Provider configured in the next section.

#### Collection and Provider

Cumulus will need to be configured with a Collection and Provider entry of your choosing.  The provider should match the location of the source data from the `Ingest Source Data` section.

This can be done via the [Cumulus Dashboard](https://github.com/nasa/cumulus-dashboard) if installed or the [API](../api.md).  It is strongly recommended to use the dashboard if possible.

------------
## Configure the Workflow

Provided the prerequisites have been fulfilled, you can begin adding the needed values to your Cumulus configuration to configure the example workflow.

The following are steps that are required to set up your Cumulus instance to run the example workflow:

#### Example CNM Workflow Configuration

In this example, we're going to trigger a workflow by creating a Kinesis rule and sending a record to a Kinesis stream.

The following [workflow definition](workflows/README.md) should be added to your deployment's `workflows.yml`.

Update the `CNMResponseStream` key in the `CnmResponse` task to match the name of the Kinesis response stream you configured in the prerequisites section.

```yaml
CNMExampleWorkflow:
  Comment: CNMExampleWorkflow
  StartAt: StartStatus
  States:
    StartStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}
      CumulusConfig:
        cumulus_message:
          input: '{$}'
      Next: TranslateMessage
      Catch:
        - ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: CnmResponse
    TranslateMessage:
      Type: Task
      Resource: ${CNMToCMALambdaFunction.Arn}
      CumulusConfig:
        cumulus_message:
          outputs:
            - source: '{$.cnm}'
              destination: '{$.meta.cnm}'
            - source: '{$}'
              destination: '{$.payload}'
      Catch:
        - ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: CnmResponse
      Next: SyncGranule
    SyncGranule:
      CumulusConfig:
        provider: '{$.meta.provider}'
        buckets: '{$.meta.buckets}'
        collection: '{$.meta.collection}'
        downloadBucket: '{$.meta.buckets.private.name}'
        stack: '{$.meta.stack}'
        cumulus_message:
          outputs:
            - source: '{$.granules}'
              destination: '{$.meta.input_granules}'
            - source: '{$}'
              destination: '{$.payload}'
      Type: Task
      Resource: ${SyncGranuleLambdaFunction.Arn}
      Retry:
        - ErrorEquals:
            - States.ALL
          IntervalSeconds: 10
          MaxAttempts: 3
      Catch:
        - ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: CnmResponse
      Next: CnmResponse
    CnmResponse:
      CumulusConfig:
        OriginalCNM: '{$.meta.cnm}'
        CNMResponseStream: 'ADD YOUR RESPONSE STREAM HERE'
        region: 'us-east-1'
        WorkflowException: '{$.exception}'
        cumulus_message:
          outputs:
            - source: '{$}'
              destination: '{$.meta.cnmResponse}'
      Type: Task
      Resource: ${CnmResponseLambdaFunction.Arn}
      Retry:
        - ErrorEquals:
            - States.ALL
          IntervalSeconds: 5
          MaxAttempts: 3
      Catch:
        - ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: StopStatus
      Next: StopStatus
    StopStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}
      CumulusConfig:
        sfnEnd: true
        stack: '{$.meta.stack}'
        bucket: '{$.meta.buckets.internal.name}'
        stateMachine: '{$.cumulus_meta.state_machine}'
        executionName: '{$.cumulus_meta.execution_name}'
        cumulus_message:
          input: '{$}'
      Catch:
        - ErrorEquals:
          - States.ALL
          Next: WorkflowFailed
      End: true
    WorkflowFailed:
      Type: Fail
      Cause: 'Workflow failed'

```

Again, please make sure to modify the value CNMResponseStream to match the stream name (not ARN) for your Kinesis response stream.

#### Task Configuration

The following tasks are required to be defined in the `lambdas.yml` configuration file.

If you're using a deployment based on the [example deployment](https://github.com/nasa/cumulus/tree/master/example) these lambdas should already be defined for you.

###### CNMToCMA

The example workflow assumes you have a CNM to Cumulus Message Adapter (CMA) translation lambda defined as `CNMToCMA` in the `lambdas.yml` file:

```yaml
CNMToCMA:
  handler: 'gov.nasa.cumulus.CnmToGranuleHandler::handleRequestStreams'
  timeout: 300
  runtime: java8
  memory: 128
  s3Source:
    bucket: 'cumulus-data-shared'
    key: 'daacs/podaac/cnmToGranule-1.0-wCMA.zip'
  useMessageAdapter: false
  launchInVpc: true
```

`CNMToCMA` is meant for the beginning of a workflow: it maps CNM granule information to a payload for downstream tasks. This workflow will not utilize the payload. For other workflows, you would need to ensure that downstream tasks in your workflow either understand the CNM message *or* include a translation task like this one.

You can also manipulate the data sent to downstream tasks using `CumulusConfig` for various states in `workflows.yml`. Read more about how to configure data on the [Workflow Input & Output](https://nasa.github.io/cumulus/docs/workflows/input_output) page.

###### CnmResponse

The workflow defined above assumes a CNM response task defined in the `lambdas.yml` configuration file. Example:

```yaml
CnmResponse:
  handler: 'gov.nasa.cumulus.CNMResponse::handleRequestStreams'
  timeout: 300
  useMessageAdapter: false
  runtime: java8
  memory: 256
  s3Source:
    bucket: 'cumulus-data-shared'
    key: 'daacs/podaac/cnmResponse-1.0.zip'
  launchInVpc: true
```

The `CnmResponse` lambda generates a CNM response message and puts it on a the `CNMResponseStream` Kinesis stream.

The `CnmResponse` lambda package is provided (as of release 1.8) in the `cumulus-data-shared` bucket, with documentation provided in the [source repository](https://git.earthdata.nasa.gov/projects/POCUMULUS/repos/cnmresponsetask/browse).

You can read more about the expected schema a `CnmResponse` record on the wiki page for [Cloud Notification Mechanism](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cloud+Notification+Mechanism#CloudNotificationMechanism-ResponseMessageFields).


###### Additional Tasks

Lastly, this entry also includes the tasks  `SfSnsReport`, `SyncGranule` from the [example deployment](https://github.com/nasa/cumulus/tree/master/example) are defined in the `lambdas.yml`.

### Redeploy

Once the above configuration changes have been made, redeploy your stack.

Please refer to `Updating Cumulus deployment` in the [deployment documentation](deployment/README.md) if you are unfamiliar with redeployment.

### Rule Configuration

`@cumulus/api` includes a `messageConsumer` lambda function ([message-consumer](https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/message-consumer.js)). Cumulus kinesis-type rules create the [event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/API_CreateEventSourceMapping.html) between Kinesis streams and the `messageConsumer` lambda. The `messageConsumer` lambda consumes records from one or more Kinesis streams, as defined by enabled kinesis-type rules. When new records are pushed to one of these streams, the `messageConsumer` triggers workflows associated with the enabled kinesis-type rules.

To add a rule via the dashboard (if you'd like to use the API, see the docs [here](https://nasa.github.io/cumulus-api/#create-rule)), navigate to the `Rules` page and click `Add a rule`, then configure the new rule using the following template (substituting correct values for parameters denoted by `${}`:

```json
{
  "collection": {
    "name": "L2_HR_PIXC",
    "version": "000"
  },
  "name": "L2_HR_PIXC_kinesisRule",
  "provider": "PODAAC_SWOT",
  "rule": {
    "type": "kinesis",
    "value": "arn:aws:kinesis:{{awsRegion}}:{{awsAccountId}}:stream/{{streamName}}"
  },
  "state": "ENABLED",
  "workflow": "CNMExampleWorkflow"
}
```

**Please Note:**

- The rule's `value` attribute value must match the Amazon Resource Name [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html) for the Kinesis data stream you've preconfigured.   You should be able to obtain this ARN from the Kinesis Dashboard entry for the selected stream.
- The collection and provider should match the collection and provider you setup in the [`Prerequisites`](#prerequisites) section.

Once you've clicked on 'submit' a new rule should appear in the dashboard's Rule Overview.

------------
## Execute the Workflow

Once Cumulus has been redeployed and a rule has been added, we're ready to trigger the workflow and watch it execute.

### How to Trigger the Workflow

To trigger matching workflows, you will need to put a record on the Kinesis stream the [message-consumer](https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/message-consumer.js) lambda will recognize as a matching event. Most importantly, it should include a `collection` key / value pair that matches a valid collection.

For the purpose of this example, the easiest way to accomplish this is using the [AWS CLI](https://aws.amazon.com/cli/).

#### Create Record JSON

Construct a JSON file containing an object that matches the values that have been previously setup. This JSON object should be a valid [Cloud Notification Mechanism](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cloud+Notification+Mechanism) message.

**Please note**: *this example is somewhat contrived, as the downstream tasks don't care about most of these fields. A 'real' data ingest workflow would.*

The following values (denoted by ${} in the sample below) should be replaced to match values we've previously configured:

-  `TEST_DATA_FILE_NAME`:  The filename of the test data that is available in the S3 (or other) provider we created earlier.
-  `TEST_DATA_URI`: The full S3 path to the test data (e.g. s3://bucket-name/path/granule)
-  `COLLECTION`:  The collection defined in the prerequisites for this product

```json
{
  "product": {
    "files": [
      {
        "checksum-type": "md5",
        "name": "${TEST_DATA_FILE_NAME}",
        "checksum": "bogus_checksum_value",
        "uri": "${TEST_DATA_URI}",
        "type": "data",
        "size": 12345678
      }
    ],
    "name": "${TEST_DATA_FILE_NAME}",
    "dataVersion": "006"
  },
  "identifier ": "testIdentifier123456",
  "collection": "${COLLECTION}",
  "provider": "TestProvider",
  "version": "001"
}
```

#### Add Record to Kinesis Data Stream

Using the JSON file you created, push it to the Kinesis notification stream:

```bash
aws kinesis put-record --stream-name YOUR_KINESIS_NOTIFICATION_STREAM_NAME_HERE --partition-key 1 --data file:///path/to/file.json
```

**Please note**: The above command uses the stream name, *not* the ARN.


The command should return output similar to:
```json
{
    "ShardId": "shardId-000000000000",
    "SequenceNumber": "42356659532578640215890215117033555573986830588739321858"
}
```

This command will put a record containing the JSON from the `--data` flag onto the Kinesis data stream. The `messageConsumer` lambda will consume the record and construct a valid CMA payload to trigger workflows. For this example, the record will trigger the `CNMExampleWorkflow` workflow as defined by the rule previously configured.

You can view the current running executions on the `Executions` dashboard page which presents a list of all executions, their status (running, failed, or completed), to which workflow the execution belongs, along with other information.

### Verify Workflow Execution

As detailed above, once the record is added to the Kinesis data stream, the `messageConsumer` lambda will trigger the `CNMExampleWorkflow` .

#### StartStatus

The first task in the execution will report to Cumulus that the workflow has started execution and pass the CNM message to the next step in the workflow

#### TranslateMessage

`TranslateMessage` (which corresponds to the `CNMToCMA` lambda) will take the CNM object payload and add a granules object to the CMA payload that's consistent with other Cumulus ingest tasks, and add a key 'cnm' to 'meta' (as well as the payload) to store the original message.

*For more on the Message Adapter, please see [the Message Flow documentation](workflows/cumulus-task-message-flow.md)*.

An example of what is happening in the `CNMToCMA` lambda is as follows:

Example Input Payload:

```json
"payload": {
  "identifier ": "testIdentifier123456",
  "product": {
    "files": [
      {
        "checksum-type": "md5",
        "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
        "checksum": "bogus_checksum_value",
        "uri": "s3://some_bucket/cumulus-test-data/pdrs/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
        "type": "data",
        "size": 12345678
      }
    ],
    "name": "TestGranuleUR",
    "dataVersion": "006"
  },
  "version": "123456",
  "collection": "MOD09GQ",
  "provider": "TestProvider"
}
```

Example Output Payload:

```json
  "payload": {
    "cnm": {
      "identifier ": "testIdentifier123456",
      "product": {
        "files": [
          {
            "checksum-type": "md5",
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "checksum": "bogus_checksum_value",
            "uri": "s3://some-bucket/cumulus-test-data/data/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "type": "data",
            "size": 12345678
          }
        ],
        "name": "TestGranuleUR",
        "dataVersion": "006"
      },
      "version": "123456",
      "collection": "MOD09GQ",
      "provider": "TestProvider"
    },
    "granules": [
      {
        "granuleId": "TestGranuleUR",
        "files": [
          {
            "path": "some-bucket/data",
            "url_path": "s3://some-bucket/cumulus-test-data/data/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "bucket": "some-bucket",
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "size": 12345678
          }
        ]
      }
    ]
  }
```


#### SyncGranules

This lambda will take the files listed in the payload and move them to `s3://{deployment-private-bucket}/file-staging/{deployment-name}/{COLLECTION}/{file_name}`.

#### CnmResponse

Assuming a successful execution of the workflow, this task will recover the 'cnm' key from the 'meta' portion of the CMA output, and add a "SUCCESS" record to the notification Kinesis stream.

If a prior step in the the workflow has failed, this will add a "FAILURE" record to the stream instead.

The data written to the `CnmResponseStream` should adhere to the [Response Message Fields](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cloud+Notification+Mechanism#CloudNotificationMechanism-ResponseMessageFields) schema.

**Example CNM Success Response**

```json
{
  "provider": "PODAAC_SWOT",
  "collection": "SWOT_Prod_l2:1",
  "ingestTime":"2017-09-30T03:45:29.791198",
  "receivedTime":"2017-09-30T03:42:31.634552",
  "deliveryTime":"2017-09-30T03:42:29.791198",
  "identifier": "1234-abcd-efg0-9876",
  "response": {
    "status":"SUCCESS"
  }
}
```

**Example CNM Error Response**

```json
{
  "provider": "PODAAC_SWOT",
  "collection": "SWOT_Prod_l2:1",
  "ingestTime":"2017-09-30T03:45:29.791198",
  "deliveryTime":"2017-09-30T03:42:29.791198",
  "receivedTime":"2017-09-30T03:42:31.634552",
  "identifier": "1234-abcd-efg0-9876",
  "response": {
    "status":"FAILURE",
    "errorCode": "INGEST_ERROR",
    "errorMessage": "File [cumulus-dev-a4d38f59-5e57-590c-a2be-58640db02d91/prod_20170926T11:30:36/production_file.nc] did not match gve checksum value."
  }
}
```

Note the `CnmResponse` state defined in the `workflows.yml` above configures `$.exception` to be passed to the `CnmResponse` lambda keyed under `config.WorkflowException`. This is required for the `CnmResponse` code to deliver a failure response.

To test the failure scenario, send a record missing the `collection` key.

#### StopStatus

In case of either success *or* failure, `CnmResponse` will then pass the results to `StopStatus`. `StopStatus` will cause the workflow to fail or succeed accordingly.

-----------
## Verify results

### Check for successful execution on the dashboard

Following the successful execution of this workflow, you should expect to see the workflow complete successfully on the dashboard:

![](assets/cnm_success_example.png)

### Check the test granule has been delivered to S3 staging

The test granule identified in the Kinesis record should be moved to the deployment's private staging area.

### Check for Kinesis records

A `SUCCESS` notification should be present on the `CNMResponseStream` Kinesis stream.

You should be able to validate the notification and response streams have the expected records with the following steps (the AWS CLI Kinesis [Basic Stream Operations](https://docs.aws.amazon.com/streams/latest/dev/fundamental-stream.html) is useful to review before proceeding):

- Get a shard iterator (substituting your stream name as appropriate):

```bash
aws kinesis get-shard-iterator \
  --shard-id shardId-000000000000 \
  --shard-iterator-type LATEST \
  --stream-name NOTIFICATION_OR_RESPONSE_STREAM_NAME
```

which should result in an output to:

```json
{
  "ShardIterator": "VeryLongString=="
}
```

- Re-trigger the workflow by using the `put-record` command from
- As the workflow completes, use the output from the `get-shard-iterator` command to request data from the stream:

```bash
aws kinesis get-records --shard-iterator SHARD_ITERATOR_VALUE
```

This should result in output similar to:

```json
{
    "Records": [
        {
            "SequenceNumber": "49586720336541656798369548102057798835250389930873978882",
            "ApproximateArrivalTimestamp": 1532664689.128,
            "Data": "eyJpZGVudGlmaWVyICI6InRlc3RJZGVudGlmaWVyMTIzNDU2IiwidmVyc2lvbiI6IjAwNiIsImNvbGxlY3Rpb24iOiJNT0QwOUdRIiwicHJvdmlkZXIiOiJUZXN0UHJvdmlkZXIiLCJwcm9kdWN0U2l6ZSI6MTkwODYzNS4wLCJyZXNwb25zZSI6eyJzdGF0dXMiOiJTVUNDRVNTIn0sInByb2Nlc3NDb21wbGV0ZVRpbWUiOiIyMDE4LTA3LTI3VDA0OjExOjI4LjkxOSJ9",
            "PartitionKey": "1"
        },
        {
            "SequenceNumber": "49586720336541656798369548102059007761070005796999266306",
            "ApproximateArrivalTimestamp": 1532664707.149,
            "Data": "eyJpZGVudGlmaWVyICI6InRlc3RJZGVudGlmaWVyMTIzNDU2IiwidmVyc2lvbiI6IjAwNiIsImNvbGxlY3Rpb24iOiJNT0QwOUdRIiwicHJvdmlkZXIiOiJUZXN0UHJvdmlkZXIiLCJwcm9kdWN0U2l6ZSI6MTkwODYzNS4wLCJyZXNwb25zZSI6eyJzdGF0dXMiOiJTVUNDRVNTIn0sInByb2Nlc3NDb21wbGV0ZVRpbWUiOiIyMDE4LTA3LTI3VDA0OjExOjQ2Ljk1OCJ9",
            "PartitionKey": "1"
        }
    ],
    "NextShardIterator": "AAAAAAAAAAFo9SkF8RzVYIEmIsTN+1PYuyRRdlj4Gmy3dBzsLEBxLo4OU+2Xj1AFYr8DVBodtAiXbs3KD7tGkOFsilD9R5tA+5w9SkGJZ+DRRXWWCywh+yDPVE0KtzeI0andAXDh9yTvs7fLfHH6R4MN9Gutb82k3lD8ugFUCeBVo0xwJULVqFZEFh3KXWruo6KOG79cz2EF7vFApx+skanQPveIMz/80V72KQvb6XNmg6WBhdjqAA==",
    "MillisBehindLatest": 0
}
```

Note the data encoding is not human readable and would need to be parsed/converted to be interpretable. There are many options to build a Kineis consumer such as the [KCL](https://docs.aws.amazon.com/streams/latest/dev/developing-consumers-with-kcl.html).

For purposes of validating the workflow, it may be simpler to locate the workflow in the [Step Function Management Console](https://console.aws.amazon.com/states/home) and assert the expected output is similar to the below examples.

**Successful CNM Response Object Example:**

```json
{
  "cnmResponse": {
    "productSize": 12345678,
    "processCompleteTime": "2018-07-27T05:43:41.698",
    "collection": "MOD09GQ",
    "version": "123456",
    "provider": "TestProvider",
    "identifier ": "testIdentifier123456",
    "response": {
      "status": "SUCCESS"
  }
}
```


------------
## Kinesis Record Error Handling

### messageConsumer

The default Kinesis stream processing in the Cumulus system is configured for record error tolerance.

When the `messageConsumer` fails to process a record, the failure is captured and the record is published to the `kinesisFallback` SNS Topic. The `kinesisFallback` SNS topic broadcasts the record and a subscribed copy of the `messageConsumer` lambda named `kinesisFallback` consumes these failures.

At this point, the [normal lambda asynchronous invocation retry behavior](https://docs.aws.amazon.com/lambda/latest/dg/retries-on-errors.html) will attempt to process the record 3 mores times. After this, if the record cannot successfully be processed, it is written to a [dead letter queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html). Cumulus' dead letter queue is an SQS Queue named `kinesisFailure`. Operators can use this queue to inspect failed records.

This system ensures when `messageConsumer` fails to process a record and trigger a workflow, the record is retried 3 times. This retry behavior improves system reliability in case of any external service failure outside of Cumulus control.

The Kinesis error handling system - the `kinesisFallback` SNS topic, `messageConsumer` lambda, and `kinesisFailure` SQS queue - come with the API package and do not need to be configured by the operator.

To examine records that were unable to be processed at any step you need to go look at the dead letter queue `{{prefix}}-kinesisFailure`.
Check the [Simple Queue Service (SQS) console](https://console.aws.amazon.com/sqs/home). Select your queue, and under the `Queue Actions` tab, you can choose `View/Delete Messages`. `Start polling` for messages and you will see records that failed to process through the `messageConsumer`.

Note, these are only records that occurred when processing records from Kinesis streams. Workflow failures are handled differently.

### Kinesis Stream logging

#### Notification Stream messages

Cumulus includes two lambdas (`KinesisInboundEventLogger` and `KinesisOutboundEventLogger`) that utilize the same code to take a Kinesis record event as input, deserialize the data field and output the modified event to the logs.

When a `kinesis` rule is created, in addition to the `messageConsumer` event mapping, an event mapping is created to trigger `KinesisInboundEventLogger` to record a log of the inbound record, to allow for analysis in case of unexpected failure.

#### Response Stream messages

Cumulus also supports this feature for all outbound  messages.  To take advantage of this feature, you will need to set an event mapping on the `KinesisOutboundEventLogger` lambda that targets your `cnmResponseStream`.   You can do this in the Lambda management page for `KinesisOutboundEventLogger`.    Add a Kinesis trigger, and configure it to target the cnmResponseStream for your workflow:

![](assets/KinesisLambdaTriggerConfiguration.png)

Once this is done, all records sent to the cnmResponseStream will also be logged in CloudWatch.    For more on configuring lambdas to trigger on Kinesis events, please see [creating an event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/with-kinesis.html#services-kinesis-eventsourcemapping).
