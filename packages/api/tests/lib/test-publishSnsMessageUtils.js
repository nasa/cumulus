'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { sns, sqs } = require('@cumulus/aws-client/services');

const {
  publishGranuleSnsMessage,
} = require('../../lib/publishSnsMessageUtils');

const {
  fakeGranuleFactoryV2,
  fakeFileFactory,
} = require('../../lib/testUtils');

test.serial('publishGranuleSnsMessage() does not publish an SNS message if granule_sns_topic_arn is undefined', async (t) => {
  const newGranule = fakeGranuleFactoryV2({
    granuleId: cryptoRandomString({ length: 5 }),
  });
  await t.throwsAsync(
    publishGranuleSnsMessage(newGranule),
    { message: 'The granule_sns_topic_arn environment variable must be set' }
  );
});

test.serial('publishGranuleSnsMessage() publishes an SNS message for the Delete event', async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.granule_sns_topic_arn = TopicArn;

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

  const granuleId = cryptoRandomString({ length: 10 });
  const files = [fakeFileFactory()];
  const newGranule = fakeGranuleFactoryV2({
    files,
    granuleId,
    published: false,
  });
  await publishGranuleSnsMessage(newGranule, 'Delete');

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsMessageBody = JSON.parse(Messages[0].Body);
  const publishedMessage = JSON.parse(snsMessageBody.Message);

  t.deepEqual(publishedMessage.record.granuleId, granuleId);
  t.deepEqual(publishedMessage.event, 'Delete');
  t.true(publishedMessage.deletedAt < Date.now());
});
