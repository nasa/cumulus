---
id: replay-kinesis-messages
title: How to replay Kinesis messages after an outage
hide_title: false
---

After a period of outage, it may be necessary for a Cumulus operator to reprocess or 'replay' messages that arrived on an AWS Kinesis Data Stream but did not trigger an ingest. This document serves as an outline on how to start a replay operation, and how to perform status tracking. Cumulus supports replay of all Kinesis messages on a stream (subject to the normal RetentionPeriod constraints), or all messages within a given time slice delimited by start and end timestamps.

As Kinesis has no comparable field to e.g. the SQS ReceiveCount on its records, Cumulus cannot tell which messages within a given time slice have never been processed, and cannot guarantee only missed messages will be processed. Users will have to rely on duplicate handling or some other method of identifying messages that should not be processed within the time slice.

:::note

This operation flow effectively changes only the trigger mechanism for Kinesis ingest notifications. The existence of valid Kinesis-type rules and all other normal requirements for the triggering of ingest via Kinesis still apply.

:::

## Replays endpoint

Cumulus has added a new endpoint to its API, `/replays`. This endpoint will allow you to start replay operations and returns an AsyncOperationId for operation status tracking.

## Start a replay

In order to start a replay, you must perform a `POST` request to the `replays` endpoint.

The required and optional fields that should be part of the body of this request are documented below.

NOTE: As the `endTimestamp` relies on a comparison with the Kinesis server-side `ApproximateArrivalTimestamp`, and given that there is no documented level of accuracy for the approximation, it is recommended that the `endTimestamp` include some amount of buffer to allow for slight discrepancies.
If tolerable, the same is recommended for the `startTimestamp` although it is used differently and less vulnerable to discrepancies since a server-side arrival timestamp should never be earlier than the client-side request timestamp.

| Field | Type | Required | Description |
| ------ | ------ | ------ | ------ |
| `type` | string | required | Currently only accepts `kinesis`. |
| `kinesisStream` | string | for type `kinesis` | Any valid kinesis stream name (*not* ARN) |
| `kinesisStreamCreationTimestamp` | * | optional | Any input valid for a JS Date constructor. For reasons to use this field see [AWS documentation on StreamCreationTimestamp](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_ListShards.html#API_ListShards_RequestSyntax). |
| `endTimestamp` | * | optional | Any input valid for a JS Date constructor. Messages newer than this timestamp will be skipped.
| `startTimestamp` | * | optional | Any input valid for a JS Date constructor. Messages will be fetched from the Kinesis stream starting at this timestamp. Ignored if it is further in the past than the stream's retention period. |

## Status tracking

A successful response from the `/replays` endpoint will contain an `asyncOperationId` field.
Use this ID with the `/asyncOperations` endpoint to track the status.
