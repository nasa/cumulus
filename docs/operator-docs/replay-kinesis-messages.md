---
id: replay-kinesis-messages
title: Replay Kinesis Messages
hide_title: true
---

# How to replay Kinesis messages after an outage

After a period of outage, it may be necessary for a DAAC to reprocess or 'replay' messages that arrived on a Kinesis stream but did not trigger an ingest. This document serves as an outline on how to start a replay operation, and how to perform status tracking.

## Replays endpoint

Cumulus has added a new endpoint to its API, `/replays`. This endpoint will allow you to start replay operations and returns an AsyncOperationId for operation status tracking.

## Start a replay

In order to start a replay, you must perform a `POST` request to the `replays` endpoint.

The required and optional fields that should be part of the body of this request are documented below.

| Field | Type | Required | Description |
| ------ | ------ | ------ | ------ |
| type | string | required | Currently only accepts 'kinesis' |
| kinesisStream | string | if `type: kinesis` | any valid kinesis stream name (*not* ARN) |
| kinesisStreamCreationTimestamp | string | optional | any input valid for a JS Date constructor, see [AWS documentation on StreamCreationTimestamp](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_ListShards.html#API_ListShards_RequestSyntax) for details on this field. |
| endTimestamp | string | optional | any input valid for a JS Date constructor. Messages newer than this timestamp will be skipped.
| startTimestamp | string | optional | any input valid for a JS Date constructor. Messages will be fetched from the Kinesis stream starting at this timestamp. Ignored if it is further in the past than the stream's retention period. |

## Status tracking

A successful response from the `/replays` endpoint will contain an `asyncOperationId` field.
Use this ID with the `/asyncOperations` endpoint to track the status.
