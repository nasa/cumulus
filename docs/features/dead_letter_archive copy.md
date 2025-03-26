---
id: change_granule_collection
title: Cumulus Change Granule Collections
hide_title: false
---

This documentation explains the process of transitioning granules across collections.

## BulkChangeCollection Api Endpoint

An api endpoint is exposed, along with a function in the @cumulus/api-client.
- api endpoint - POST `/bulkChangeCollection`
- api-client function - `@cumulus/api-client/granules/bulkChangeCollection`

The api-client function accepts the following configurations that specify its targets
- `sourceCollectionId` - specifies the collection *from* which granules should be transfered
- `targetCollectionId` - specifies the collection *to* which granules should be transfered

additionally the api-client function accepts the following configurations that help bound performance
- `batchSize`
- `concurrency`
- `

## Dead Letter Archive recovery

In addition to the above, as of Cumulus v9+, the Cumulus API also contains a new endpoint at `/deadLetterArchive/recoverCumulusMessages`.

Sending a POST request to this endpoint will trigger a Cumulus AsyncOperation that will attempt to reprocess (and if successful delete) all Cumulus messages in the dead letter archive, using the same underlying logic as the existing `sfEventSqsToDbRecords`. Otherwise, all Cumulus messages that fail to be reprocessed will be moved to a new archive location under the path `<stackName>/dead-letter-archive/failed-sqs/<YYYY-MM-DD>`.

This endpoint may prove particularly useful when recovering from extended or unexpected database outage, where messages failed to process due to external outage and there is no essential malformation of each Cumulus message.

### Configurable request parameters

The DLA recovery endpoint takes the following configurations that help bound performance.

- `batchSize` - specifies how many DLA objects to read from S3 and hold in memory.    Increasing this value will cause the tool to read and hold `batchSize` DLA objects in memory and iterate over them with `concurrency` operations in parallel.   Defaults to 1000.
- `concurrency` - specifies how many messages to process from the batch in parallel.  Defaults to 30.
- `dbMaxPool` - specifies how many database connections to allow the process to utilize as part of it's connection pool.     This value will constrain database connections, but too low a value can cause performance issues or database write failures (Knex timeout errors) if the connection pool is not high enough to support the set concurrency.   Defaults to 30, value should target at minimum the value set for `concurrency`.

### Dead Letter Archive Recovery Configuration

The dead letter archive async operation environment can be configured to allow use of more memory/CPU if increased performance/concurrency is desired via the following `cumulus` terraform variables:

- dead_letter_recovery_cpu
- dead_letter_recovery_memory

These values can be configured to increase according to configuration table in [Fargate Services Documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html) if the process is failing due to memory errors with high concurrency/connection limits/faster performance is desired.

See [Cumulus DLA Documentation](https://nasa.github.io/cumulus/docs/features/dead_letter_archive) for more information on this feature.

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

The body attribute should be a JSON string containing an event bridge event

Note that

- Because this message body arrived in the Dead Letter Archive because of issues in processing it, there is no strict guarantee that it is a valid json object, or conforms to expected structure. the *expected* structure follows.
- Automated processing of these messages *must* be prepared for attributes to be missing.

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
    executionArn: [string], // ARN of the triggering execution
    stateMachineArn: [string], // ARN of the triggering workflow
    name: [string], // Execution name of triggering execution
    status: [string], // status of triggering execution
    startDate: [int], // timestamp of
    stopDate: [int | null], // timestamp of
    input: [string], //parses as the cumulus message input
    output: [string | null], //parses as the cumulus message output if execution succeeded
    stateMachineVersionArn: [string | null], // The version ARN is a combination of state machine ARN and the version number separated by a colon (:)
    stateMachineAliasArn: [string | null], // a combination of state machine ARN and the alias name separated by a colon (:)
    inputDetails: [CloudWatchEventsExecutionDataDetails], // Details about execution input
    outputDetails: [CloudWatchEventsExecutionDataDetails | null], // Details about execution output
    error: [string | null], // The cause string if the state machine execution failed (most errors that send to the DLA will not have a *caught* failure that does not arrive here)
    cause: [string | null], // the cause string if the state machine execution failed
    /* note that these redrive statistics can be misleading, as they are not referring to the execution that failed if the triggering execution was sfEventSqsToDbRecords*/
    redriveCount: [int],
    redriveDate: [string | null],
    redriveStatus: [string],
    redriveStatusReason: [string],
}
```

## Search and View Dead Letter Archive Messages

[Amazon Athena](https://docs.aws.amazon.com/athena/latest/ug/what-is.html) is a powerful serverless query service that allows us
to analyze data directly from Amazon S3 using standard SQL. One of the key features of Athena is its support for partition
projection. [Partition projection](https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html) allows us to define a
virtual partitioning scheme for our data stored in Amazon S3 without physically partitioning the data.

We have provided an AWS Glue Catalog database, an AWS Glue Catalog table and an example query for querying S3 DLA messages.
Our AWS Glue Catalog table `<prefix>_dla_glue_table` defines partition projection for `eventdate` key which corresponds
to `date` folder under Dead Letter Archive S3 storage location.

**Note:** `<prefix>` is your stack name with dash replaced by underscore

### Procedure

1. Navigate to AWS Athena Console:

    Launch query editor to `Query your data with Trino SQL`.

    Choose Workgroup `<prefix>_athena_workgroup` from the workgroup drop down menu and acknowledge `Workgroup <prefix>_athena_workgroup settings`.

    The `Saved queries` tab should have an example query `<prefix>_athena_test_query`, click it to open.

    Select the appropriate database `<prefix>_glue_database` from the Database dropdown menu and run the query.

2. Write and Run the Query:

    When the query includes the partition key `eventdate`, the query on the table will be executed using `partition projection`
    settings and would result in faster results by directly scanning the folder and files based on the partition information
    provided in the query.

    In the following query, the data is filtered based on the eventdate partition key and a specific value in the granules column.
    `$path` returns the S3 file location for the data in a table row.

    ```sql
    select "$path",
        *
    from <prefix>_dla_glue_table
    where eventdate between '2024-03-10' and '2024-03-15'
        and contains(
            granules,
            'MOD09GQ.A5039420.mQk0tM.006.9370766211793'
        )
    ```

    See [SQL reference for Athena](https://docs.aws.amazon.com/athena/latest/ug/ddl-sql-reference.html) for the complete SQL guide.
