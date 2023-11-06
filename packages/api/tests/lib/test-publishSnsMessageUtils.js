'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { sqs } = require('@cumulus/aws-client/services');
const { sendSNSMessage } = require('@cumulus/aws-client/SNS');

const {
  publishSnsMessageByDataType,
} = require('../../lib/publishSnsMessageUtils');

const {
  fakeExecutionFactoryV2,
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
  fakeFileFactory,
  fakePdrFactoryV2,
} = require('../../lib/testUtils');

test.before((t) => {
  t.context.timeBeforePublish = Date.now();
});

test.beforeEach(async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = sendSNSMessage({ Name: topicName }, 'CreateTopicCommand');
  t.context.TopicArn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  }).promise();
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;
  const { SubscriptionArn } = sendSNSMessage({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }, 'SubscribeCommand');

  sendSNSMessage({
    TopicArn,
    Token: SubscriptionArn,
  }, 'ConfirmSubscriptionCommand');
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;

  await Promise.all([
    sqs().deleteQueue({ QueueUrl }).promise(),
    sendSNSMessage({ TopicArn }, 'DeleteTopicCommand'),
  ]);
});

test.serial('publishSnsMessageByDataType() does not publish an execution SNS message if execution_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newExecution = fakeExecutionFactoryV2({
    arn: cryptoRandomString({ length: 5 }),
    status: 'completed',
    name: 'test_execution',
  });
  await t.throwsAsync(
    publishSnsMessageByDataType(newExecution, 'execution'),
    { message: 'The execution_sns_topic_arn environment variable must be set' }
  );
  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishSnsMessageByDataType() publishes an SNS message for execution', async (t) => {
  process.env.execution_sns_topic_arn = t.context.TopicArn;
  const executionArn = cryptoRandomString({ length: 10 });
  const newExecution = fakeExecutionFactoryV2({
    arn: executionArn,
    status: 'completed',
    name: 'test_execution',
  });
  await publishSnsMessageByDataType(newExecution, 'execution');

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

test.serial('publishSnsMessageByDataType() does not publish a collection SNS message if collection_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newCollection = fakeCollectionFactory();

  t.teardown(() => {
    process.env.collection_sns_topic_arn = t.context.TopicArn;
  });

  await t.throwsAsync(
    publishSnsMessageByDataType(newCollection, 'collection', 'Update'),
    { message: 'The collection_sns_topic_arn environment variable must be set' }
  );

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishSnsMessageByDataType() publishes a collection SNS message for the event type Create', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishSnsMessageByDataType(newCollection, 'collection', 'Create');

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

test.serial('publishSnsMessageByDataType() publishes a collection SNS message for the event type Update', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishSnsMessageByDataType(newCollection, 'collection', 'Update');

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

test.serial('publishSnsMessageByDataType() publishes a collection SNS message for the event type Delete', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;

  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishSnsMessageByDataType(newCollection, 'collection', 'Delete');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);

  t.deepEqual(message.record, { name: newCollection.name, version: newCollection.version });
  t.is(message.event, 'Delete');
  t.true(message.deletedAt > t.context.timeBeforePublish);
  t.true(message.deletedAt < Date.now());
});

test.serial('publishSnsMessageByDataType() does not publish an SNS message if granule_sns_topic_arn is undefined', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    granuleId: cryptoRandomString({ length: 5 }),
  });
  await t.throwsAsync(
    publishSnsMessageByDataType(newGranule, 'granule'),
    { message: 'The granule_sns_topic_arn environment variable must be set' }
  );
});

test.serial('publishSnsMessageByDataType() publishes an SNS message for the granule Delete event', async (t) => {
  process.env.granule_sns_topic_arn = t.context.TopicArn;

  const granuleId = cryptoRandomString({ length: 10 });
  const files = [fakeFileFactory()];
  const newGranule = fakeGranuleFactoryV2({
    files,
    granuleId,
    published: false,
  });
  await publishSnsMessageByDataType(newGranule, 'granule', 'Delete');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const snsMessageBody = JSON.parse(Messages[0].Body);
  const publishedMessage = JSON.parse(snsMessageBody.Message);

  t.deepEqual(publishedMessage.record.granuleId, granuleId);
  t.deepEqual(publishedMessage.event, 'Delete');
  t.true(publishedMessage.deletedAt > t.context.timeBeforePublish);
  t.true(publishedMessage.deletedAt < Date.now());
});

test.serial('publishSnsMessageByDataType() does not publish a PDR SNS message if pdr_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newPdr = fakePdrFactoryV2({
    pdrName: 'test_pdr',
  });
  await t.throwsAsync(
    publishSnsMessageByDataType(newPdr, 'pdr'),
    { message: 'The pdr_sns_topic_arn environment variable must be set' }
  );

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishSnsMessageByDataType() publishes a PDR SNS message', async (t) => {
  const { TopicArn, QueueUrl } = t.context;
  process.env.pdr_sns_topic_arn = TopicArn;

  const pdrName = cryptoRandomString({ length: 10 });
  const newPdr = fakePdrFactoryV2({
    pdrName,
  });
  await publishSnsMessageByDataType(newPdr, 'pdr');

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const pdrRecord = JSON.parse(snsMessage.Message);

  t.deepEqual(pdrRecord.pdrName, pdrName);
  t.deepEqual(pdrRecord.status, newPdr.status);
});

test.serial('constructCollectionSnsMessage throws if eventType is not provided', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await t.throwsAsync(
    publishSnsMessageByDataType(newCollection, 'collection'),
    { message: 'Invalid eventType: undefined' }
  );
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});

test.serial('constructCollectionSnsMessage throws if eventType is invalid', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  const invalidEventType = 'Modify';
  await t.throwsAsync(
    publishSnsMessageByDataType(newCollection, 'collection', invalidEventType),
    { message: `Invalid eventType: ${invalidEventType}` }
  );
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});

test.serial('constructGranuleSnsMessage throws if eventType is not provided', async (t) => {
  process.env.granule_sns_topic_arn = t.context.TopicArn;
  const granuleId = cryptoRandomString({ length: 10 });
  const files = [fakeFileFactory()];
  const newGranule = fakeGranuleFactoryV2({
    files,
    granuleId,
    published: false,
  });
  await t.throwsAsync(
    publishSnsMessageByDataType(newGranule, 'granule'),
    { message: 'Invalid eventType: undefined' }
  );
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});

test.serial('constructGranuleSnsMessage throws if eventType is invalid', async (t) => {
  process.env.granule_sns_topic_arn = t.context.TopicArn;
  const granuleId = cryptoRandomString({ length: 10 });
  const files = [fakeFileFactory()];
  const newGranule = fakeGranuleFactoryV2({
    files,
    granuleId,
    published: false,
  });
  const invalidEventType = 'Modify';
  await t.throwsAsync(
    publishSnsMessageByDataType(newGranule, 'granule', invalidEventType),
    { message: `Invalid eventType: ${invalidEventType}` }
  );
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});
