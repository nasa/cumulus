'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { sns, sqs } = require('@cumulus/aws-client/services');

const {
  publishPdrSnsMessage,
} = require('../../lib/publishSnsMessageUtils');

const {
  fakePdrFactoryV2,
} = require('../../lib/testUtils');

test.serial('publishPdrSnsMessage() does not publish an SNS message if pdr_sns_topic_arn is undefined', async (t) => {
  const newPdr = fakePdrFactoryV2({
    pdrName: 'test_pdr',
  });
  await t.throwsAsync(
    publishPdrSnsMessage(newPdr),
    { message: 'The pdr_sns_topic_arn environment variable must be set' }
  );
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
    Token: SubscriptionArn
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