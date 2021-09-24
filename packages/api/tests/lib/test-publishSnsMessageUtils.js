'use strict';

const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');

const { sns, sqs } = require('@cumulus/aws-client/services');

const {
  publishExecutionSnsMessage,
  publishCollectionSnsMessage,
  publishPdrSnsMessage,
} = require('../../lib/publishSnsMessageUtils');

const {
  fakeExecutionFactoryV2,
  fakeCollectionFactory,
  fakePdrFactoryV2,
} = require('../../lib/testUtils');

test.before(async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  t.context.TopicArn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;
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
});

test.after.always(async (t) => {
  const { QueueUrl, TopicArn } = t.context;

  await Promise.all([
    sqs().deleteQueue({ QueueUrl }).promise(),
    sns().deleteTopic({ TopicArn }).promise(),
  ]);
});

test.serial('publishExecutionSnsMessage() does not publish an SNS message if execution_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newExecution = fakeExecutionFactoryV2({
    arn: cryptoRandomString({ length: 5 }),
    status: 'completed',
    name: 'test_execution',
  });
  await t.throwsAsync(
    publishExecutionSnsMessage(newExecution),
    { message: 'The execution_sns_topic_arn environment variable must be set' }
  );
  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishExecutionSnsMessage() publishes an SNS message', async (t) => {
  process.env.execution_sns_topic_arn = t.context.TopicArn;
  const executionArn = cryptoRandomString({ length: 10 });
  const newExecution = fakeExecutionFactoryV2({
    arn: executionArn,
    status: 'completed',
    name: 'test_execution',
  });
  await publishExecutionSnsMessage(newExecution);

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const executionRecord = JSON.parse(snsMessage.Message);

  t.deepEqual(executionRecord.arn, executionArn);
  t.deepEqual(executionRecord.status, newExecution.status);
});

test.serial('publishCollectionSnsMessage() does not publish an SNS message if collection_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newCollection = fakeCollectionFactory();

  t.teardown(() => {
    process.env.collection_sns_topic_arn = t.context.TopicArn;
  });

  await t.throwsAsync(
    publishCollectionSnsMessage(newCollection),
    { message: 'The collection_sns_topic_arn environment variable must be set' }
  );

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishCollectionSnsMessage() publishes an SNS message for the event type Create', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishCollectionSnsMessage(newCollection, 'Create');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);

  t.deepEqual(message.record, newCollection);
  t.is(message.event, 'Create');
});

test.serial('publishCollectionSnsMessage() publishes an SNS message for the event type Update', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishCollectionSnsMessage(newCollection, 'Update');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);

  t.deepEqual(message.record, newCollection);
  t.is(message.event, 'Update');
});

test.serial('publishCollectionSnsMessage() publishes an SNS message for the event type Delete', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const deletedAt = Date.now();
  const stub = sinon.stub(Date, 'now').returns(deletedAt);
  t.teardown(() => {
    stub.restore();
  });

  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishCollectionSnsMessage(newCollection, 'Delete');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);

  t.deepEqual(message.record, { name: newCollection.name, version: newCollection.version });
  t.is(message.event, 'Delete');
  t.is(message.deletedAt, deletedAt);
});

test.serial('publishPdrSnsMessage() does not publish an SNS message if pdr_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newPdr = fakePdrFactoryV2({
    pdrName: 'test_pdr',
  });
  await t.throwsAsync(
    publishPdrSnsMessage(newPdr),
    { message: 'The pdr_sns_topic_arn environment variable must be set' }
  );

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishPdrSnsMessage() publishes an SNS message', async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.pdr_sns_topic_arn = TopicArn;

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

  const pdrName = cryptoRandomString({ length: 10 });
  const newPdr = fakePdrFactoryV2({
    pdrName,
  });
  await publishPdrSnsMessage(newPdr);

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const pdrRecord = JSON.parse(snsMessage.Message);

  t.deepEqual(pdrRecord.pdrName, pdrName);
  t.deepEqual(pdrRecord.status, newPdr.status);
});
