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

The Messages yielded to the dead letter archive have some inherent uncertainty to their structure due to their nature as failed messages that may have failed due to structural issues. However there is a standard format that they will overwhelmingly conform to.

```js
{
    body: <string> // parseable as EventBridge
    error: <string> // error that caused the message to be shunted to the DLQ
    execution: <string> // execution arn
    time: <string> // time
    collection: <string> // collection
    granules: <Array<string>> // granules
    stateMachine: <string> //state machine arn

}
```

note that each of these fields except for 'body' can be null if no data was found, usually due to a parsing error
for further details on body contents: [see below]

## Dead Letter Archive Body contents

the body Bttribute should be a JSON string containing an event bridge event

Note that

- the body attribute can come nested, such that you will have to de-nest a series of body attributes to get to the heart of your message
- the word body can be interchanged with Body (capitalized)
- because this message body arrived in the Dead Letter Archive because of issues in processing it, there is no strict guarantee that it is a valid json object, or conforms to expected structure. the *expected* structure follows.
