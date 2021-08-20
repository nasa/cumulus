'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { sns, sqs } = require('@cumulus/aws-client/services');

const {
  publishExecutionSnsMessage,
} = require('../../lib/publishSnsMessageUtils');

const {
  fakeExecutionFactoryV2,
} = require('../../lib/testUtils');

test.serial('publishExecutionSnsMessage() does not publish an SNS message if execution_sns_topic_arn is undefined', async (t) => {
  const newExecution = fakeExecutionFactoryV2({
    arn: cryptoRandomString({ length: 5 }),
    status: 'completed',
    name: 'test_execution',
  });
  await t.throwsAsync(
    publishExecutionSnsMessage(newExecution),
    { message: 'The execution_sns_topic_arn environment variable must be set'}
  );
});

test.serial('publishExecutionSnsMessage() publishes an SNS message', async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.execution_sns_topic_arn = TopicArn;

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

  const executionArn = cryptoRandomString({ length: 10 });
  const newExecution = fakeExecutionFactoryV2({
    arn: executionArn,
    status: 'completed',
    name: 'test_execution',
  });
  await publishExecutionSnsMessage(newExecution);

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const executionRecord = JSON.parse(snsMessage.Message);

  t.deepEqual(executionRecord.arn, executionArn);
  t.deepEqual(executionRecord.status, newExecution.status);
});
