---
id: replay-archived-sqs-messages
title: How to replay SQS messages archived in S3
hide_title: false
---
## Context

Cumulus archives all incoming SQS messages to S3 and removes messages once they have been processed. Unprocessed messages are archived at the path: `${stackName}/archived-incoming-messages/${queueName}/${messageId}`

## Replay SQS messages endpoint

The Cumulus API has added a new endpoint, `/replays/sqs`. This endpoint will allow you to start a replay operation to requeue all archived SQS messages by `queueName` and returns an AsyncOperationId for operation status tracking.

## Start replaying archived SQS messages

In order to start a replay, you must perform a `POST` request to the `replays/sqs` endpoint.

The required and optional fields that should be part of the body of this request are documented below.

| Field | Type | Description |
| ------ | ------ | ------ |
| `queueName` | string | Any valid SQS queue name (*not* ARN) | |

## Status tracking

A successful response from the `/replays/sqs` endpoint will contain an `asyncOperationId` field.
Use this ID with the `/asyncOperations` endpoint to track the status.
