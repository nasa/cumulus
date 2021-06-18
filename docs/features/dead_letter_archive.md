---
id: dead_letter_archive
title: Cumulus Dead Letter Archive
hide_title: false
---

This documentation explains the Cumulus dead letter archive and associated functionality.

## DB Records DLQ Archive

The Cumulus system contains a number of [dead letter queues](./dead_letter_queues). Of our system lambda functions, perhaps the most important of these is the `sfEventSqsToDbRecords` lambda function which parses Cumulus messages from workflow executions to generate and write database records to the Cumulus database.

As of Cumulus v9+, the dead letter queue for this lambda(`sfEventSqsToDbRecordsDeadLetterQueue`) has been updated with a consumer lambda that will automatically write any incoming records to the S3 system bucket, under the path `<stackName>/dead-letter-archive/sqs/`. This will allow integrators and operators engaged in debugging missing records to inspect any Cumulus messages which failed to process and did not result in the successful creation of database records.

## Dead Letter Archive recovery

Also as of Cumulus v9+, the Cumulus API contains a new endpoint at `/deadLetterArchive/recoverCumulusMessages`. Sending a POST request to this endpoint will trigger a Cumulus AsyncOperation that will attempt to reprocess (and if successful delete) all Cumulus messages in the dead letter archive, using the same underlying logic as the existing `sfEventSqsToDbRecords`.

This endpoint may prove particularly useful when recovering from extended or unexpected database outage, where there is no essential malformation of the Cumulus message, but messages fail to process due to external outage.
