---
id: dead_letter_archive
title: Cumulus Dead Letter Archive
hide_title: false
---

This documentation explains the Cumulus dead letter archive and associated functionality.

## DB Records DLQ Archive

The Cumulus system contains a number of [dead letter queues](./lambda_dead_letter_queue.md). Perhaps the most important system lambda function supported by a DLQ is the `sfEventSqsToDbRecords` lambda function which parses Cumulus messages from workflow executions to generate and write database records to the Cumulus database.

As of Cumulus v9+, the dead letter queue for this lambda (named `sfEventSqsToDbRecordsDeadLetterQueue`) has been updated with a consumer lambda that will automatically write any incoming records to the S3 system bucket, under the path `<stackName>/dead-letter-archive/sqs/`. This will allow integrators and operators engaged in debugging missing records to inspect any Cumulus messages which failed to process and did not result in the successful creation of database records.

## Dead Letter Archive recovery

In addition to the above, as of Cumulus v9+, the Cumulus API also contains a new endpoint at `/deadLetterArchive/recoverCumulusMessages`.

Sending a POST request to this endpoint will trigger a Cumulus AsyncOperation that will attempt to reprocess (and if successful delete) all Cumulus messages in the dead letter archive, using the same underlying logic as the existing `sfEventSqsToDbRecords`. Otherwise, all Cumulus messages that fail to be reprocessed will be moved to a new archive location under the path `<stackName>/dead-letter-archive/failed-sqs/<YYYY-MM-DD>`.

This endpoint may prove particularly useful when recovering from extended or unexpected database outage, where messages failed to process due to external outage and there is no essential malformation of each Cumulus message.

## Dead Letter Archive Message structure

The Messages yielded to the dead letter archive have some inherent uncertainty to their structure due to their nature as failed messages that may have failed due to structural issues. However there is a standard format that they will overwhelmingly conform to. This follows, but adds attributes to the format documented at [SQSMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_Message.html)

```ts
{
    body: [string], // parseable as EventBridge
    error: [string | null], // error that caused the message to be shunted to the DLQ
    execution: [string | null], // execution ARN for the execution which created the originating sf event
    time: [string | null], // Zulu timestamp of of the originating sf event
    collection: [string | null], // collection the granule belongs to
    granules: [Array[string | null] | null], // granules 
    stateMachine: [string | null], // ARN of the triggering workflow
    status: [string | null], status of triggering execution
    /* these following are standard, not built by cumulus */
    md5OfBody: [string], // checksum of message body
    eventSource: [string], // aws:sqs
    awsRegion: [string], // aws region that this is happening in
    messageId: [string], // uniqueID of the DLQ message
    receiptHandle: [string], // An identifier associated with the act of receiving the message. A new receipt handle is returned every time you receive a message.
    attributes: [Object], // A map of the attributes requested in ReceiveMessage to their respective values.
    messageAttributes: [Object], // Each message attribute consists of a Name, Type, and Value. 
}
```

note that each of these fields except for 'body' can be null if no data was found, usually due to a parsing error
for further details on body contents: [see below]

## Dead Letter Archive Body contents

the body attribute should be a JSON string containing an event bridge event

Note that

- the body attribute *can* come nested, such that you will have to de-nest a series of body attributes to get to the heart of your message
- the word body can be interchanged with Body (capitalized)
- because this message body arrived in the Dead Letter Archive because of issues in processing it, there is no strict guarantee that it is a valid json object, or conforms to expected structure. the *expected* structure follows.

```ts
{
    version: [string | null], // versionString
    id: [string | null], // unique ID of the triggering event
    'detail-type': 'Step Functions Execution Status Change', // defines the below 'detail' spec
    source: 'aws.states',
    account: [string], // account ID
    time: [string], // Zulu timestamp of the originating sf event
    region: [string], //aws region
    resources: [Array[string]], //ARNs of involved resources
    detail: [string], //parses as Step Function Execution Status Change object, see below
}
```

Step Function Execution Status Change (detail) [here](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-sfn/Interface/DescribeExecutionCommandOutput/):

```ts
{
    stateMachineArn: [string], // ARN of the triggering workflow
    name: [string], // Execution name of triggering execution
    status: [string], // status of triggering execution
    startDate: [int], // timestamp of
    stopDate: [int | null], // timestamp of
    input: [string], //parses as the cumulus message input
    output: [string | null], //parses as the cumulus message output if execution succeeded
    stateMachineVersionArn: [string | null], // The version ARN is a combination of state machine ARN and the version number separated by a colon (:)
    stateMachineAliasArn: [string | null], // a combination of state machine ARN and the alias name separated by a colon (:)
    /* note that these redrive statistics can be misleading, as they are not referring to the execution that failed if the triggering execution was sfEventSqsToDbRecords*/
    redriveCount: [int],
    redriveDate: [string | null],
    redriveStatus: [string],
    redriveStatusReason: [string],
    inputDetails: [CloudWatchEventsExecutionDataDetails], // Details about execution input
    outputDetails: [CloudWatchEventsExecutionDataDetails | null], // Details about execution output
    error: [string | null], // The cause string if the state machine execution failed (most errors that send to the DLA will not have a *caught* failure that does not arrive here)
    cause: [string | null], // the cause string if the state machine execution failed
}
```