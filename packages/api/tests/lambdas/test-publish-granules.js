'use strict';

const test = require('ava');
const { sns, sqs } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { handler } = require('../../lambdas/publish-granules');

test.before(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.granule_sns_topic_arn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn']
  }).promise();
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn
  }).promise();

  await sns().confirmSubscription({
    TopicArn,
    Token: SubscriptionArn
  }).promise();

  t.context = { QueueUrl, TopicArn };
});

test.after.always(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn }).promise();
});

test.serial('The publish-granules Lambda function takes a DynamoDB stream event with a single record and publishes a granule to SNS', async (t) => {
  const { QueueUrl } = t.context;

  const granuleId = randomString();

  const event = {
    Records: [
      {
        dynamodb: {
          NewImage: {
            granuleId: { S: granuleId },
            status: { S: 'running' }
          }
        },
        eventName: 'MODIFY'
      }
    ]
  };

  await handler(event);

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsResponse = JSON.parse(Messages[0].Body);
  const snsMessage = JSON.parse(snsResponse.Message);
  const granuleRecord = snsMessage.record;

  t.is(granuleRecord.granuleId, granuleId);
  t.is(granuleRecord.status, 'running');
  t.is(snsMessage.event, 'Update');
});

test.serial('The publish-granules Lambda function takes a DynamoDB stream event with a multiple records and publishes their granules to SNS', async (t) => {
  const { QueueUrl } = t.context;

  const event = {
    Records: [
      {
        dynamodb: {
          NewImage: {
            granuleId: { S: randomString() },
            status: { S: 'running' }
          }
        },
        eventName: 'INSERT'
      },
      {
        dynamodb: {
          NewImage: {
            granuleId: { S: randomString() },
            status: { S: 'running' }
          }
        },
        eventName: 'MODIFY'
      }
    ]
  };

  await handler(event);

  const { Messages } = await sqs().receiveMessage({
    QueueUrl,
    MaxNumberOfMessages: 2,
    WaitTimeSeconds: 10
  }).promise();

  t.is(Messages.length, 2);
});

test.serial('The publish-granules Lambda function takes a DynamoDB stream event with a REMOVE record and adds a deletedAt to the SNS message', async (t) => {
  const { QueueUrl } = t.context;

  const granuleId = randomString();

  const event = {
    Records: [
      {
        dynamodb: {
          OldImage: {
            granuleId: { S: granuleId },
            status: { S: 'running' }
          }
        },
        eventName: 'REMOVE'
      }
    ]
  };

  await handler(event);

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);
  const granuleRecord = message.record;

  t.is(granuleRecord.granuleId, granuleId);
  t.is(!!granuleRecord.deletedAt, true);
  t.is(message.event, 'Delete');
});
