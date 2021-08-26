'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { sns, sqs } = require('@cumulus/aws-client/services');

const {
  publishCollectionSnsMessage,
} = require('../../lib/publishSnsMessageUtils');

const {
  fakeCollectionFactory,
} = require('../../lib/testUtils');

test.serial('publishCollectionSnsMessage() does not publish an SNS message if collection_sns_topic_arn is undefined', async (t) => {
  const newCollection = fakeCollectionFactory();
  await t.throwsAsync(
    publishCollectionSnsMessage(newCollection),
    { message: 'The collection_sns_topic_arn environment variable must be set' }
  );
});

test.serial('publishCollectionSnsMessage() publishes an SNS message', async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.collection_sns_topic_arn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  }).promise();
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }).promise();

  await sns().confirmSubscription({
    TopicArn,
    Token: SubscriptionArn,
  }).promise();

  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishCollectionSnsMessage(newCollection, 'Create');

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);

  t.deepEqual(message.record.name, collectionName);
  t.is(message.event, 'Create');
});
