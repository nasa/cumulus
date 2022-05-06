'use strict';

const test = require('ava');
const sinon = require('sinon');
const { sns, sqs } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { handler } = require('../../lambdas/publish-collections');

const randomCollection = () => ({
  name: randomString(),
  version: randomString(),
});

test.before(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  const QueueName = randomString();
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  const { Attributes: { QueueArn } } = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  }).promise();
  const { SubscriptionArn } = await sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }).promise();

  await sns().confirmSubscription({
    TopicArn,
    Token: SubscriptionArn,
  }).promise();

  process.env.collection_sns_topic_arn = TopicArn;
  t.context = { QueueUrl, TopicArn };
});

test.after.always(async (t) => {
  const { QueueUrl, TopicArn } = t.context;

  await Promise.all([
    sqs().deleteQueue({ QueueUrl }).promise(),
    sns().deleteTopic({ TopicArn }).promise(),
  ]);
});

test.serial('The publish-collections Lambda function takes a DynamoDB stream event with a single record and publishes a collection to SNS', async (t) => {
  const { QueueUrl } = t.context;
  const collection = randomCollection();
  const event = {
    Records: [
      {
        dynamodb: {
          NewImage: {
            name: { S: collection.name },
            version: { S: collection.version },
          },
        },
        eventName: 'MODIFY',
      },
    ],
  };

  await handler(event);

  const { Messages } = await sqs().receiveMessage({
    QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const message = JSON.parse(JSON.parse(Messages[0].Body).Message);

  t.deepEqual(message, { event: 'Update', record: collection });
});

test.serial('The publish-collections Lambda function takes a DynamoDB stream event with a multiple records and publishes their collections to SNS', async (t) => {
  const { QueueUrl } = t.context;
  const collection1 = randomCollection();
  const collection2 = randomCollection();
  const event = {
    Records: [
      {
        dynamodb: {
          NewImage: {
            name: { S: collection1.name },
            version: { S: collection1.version },
          },
        },
        eventName: 'INSERT',
      },
      {
        dynamodb: {
          NewImage: {
            name: { S: collection2.name },
            version: { S: collection2.version },
          },
        },
        eventName: 'MODIFY',
      },
    ],
  };

  await handler(event);

  const receiveMessageParams = {
    QueueUrl,
    MaxNumberOfMessages: 2,
    WaitTimeSeconds: 10,
  };
  const { Messages } = await sqs().receiveMessage(receiveMessageParams).promise();
  if (Messages.length < 2) {
    const { Messages: additionalMsgs } = await sqs().receiveMessage(receiveMessageParams).promise();
    Messages.push(...additionalMsgs);
  }
  const actualMessages = Messages
    .map((message) => JSON.parse(JSON.parse(message.Body).Message))
    .sort((message) => (message.event === 'Create' ? -1 : 1));
  const expectedMessages = [
    { event: 'Create', record: collection1 },
    { event: 'Update', record: collection2 },
  ];

  t.deepEqual(actualMessages, expectedMessages);
});

test.serial('The publish-collections Lambda function takes a DynamoDB stream event with a REMOVE record and adds a deletedAt to the SNS message', async (t) => {
  const deletedAt = Date.now();
  const stub = sinon.stub(Date, 'now').returns(deletedAt);
  const { QueueUrl } = t.context;
  const { name, version } = randomCollection();
  const event = {
    Records: [
      {
        dynamodb: {
          OldImage: {
            name: { S: name },
            version: { S: version },
          },
        },
        eventName: 'REMOVE',
      },
    ],
  };

  await handler(event);

  const { Messages } = await sqs().receiveMessage({
    QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const message = JSON.parse(JSON.parse(Messages[0].Body).Message);

  t.deepEqual(message, {
    event: 'Delete',
    record: { name, version },
    deletedAt,
  });

  stub.restore();
});
