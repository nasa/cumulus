'use strict';

const test = require('ava');
const rewire = require('rewire');

const aws = require('@cumulus/common/aws');
const { noop } = require('@cumulus/common/util');
const { randomString } = require('@cumulus/common/test-utils');

const publishReports = rewire('../../lambdas/publish-reports');

const testMessagesReceived = async (t, QueueUrl, granuleId, pdrName) => {
  const { Messages } = await aws.sqs().receiveMessage({
    QueueUrl,
    WaitTimeSeconds: 10,
    MaxNumberOfMessages: 2
  }).promise();

  t.is(Messages.length, 2);

  const snsMessages = Messages.map((message) => JSON.parse(message.Body));
  const dbRecords = snsMessages.map((message) => JSON.parse(message.Message));

  const granuleRecord = dbRecords.find((r) => r.granuleId);
  t.is(granuleRecord.granuleId, granuleId);

  const pdrRecord = dbRecords.find((r) => r.pdrName);
  t.is(pdrRecord.pdrName, pdrName);
};

let revertPublishReports;

test.before(async () => {
  // Not necessary for the tests to pass, but reduces error log output
  revertPublishReports = publishReports.__set__(
    'StepFunctions',
    {
      describeExecution: () => Promise.resolve({})
    }
  );
});

test.beforeEach(async (t) => {
  // Configure the SNS topics and SQS subscriptions

  t.context.granuleSnsTopicArnEnvVarBefore = process.env.granule_sns_topic_arn;
  t.context.pdrSnsTopicArnEnvVarBefore = process.env.pdr_sns_topic_arn;

  const topicName = randomString();
  const { TopicArn } = await aws.sns().createTopic({
    Name: topicName
  }).promise();
  t.context.TopicArn = TopicArn;
  process.env.granule_sns_topic_arn = TopicArn;
  process.env.pdr_sns_topic_arn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await aws.sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;

  const getQueueAttributesResponse = await aws.sqs().getQueueAttributes({
    QueueUrl: QueueUrl,
    AttributeNames: ['QueueArn']
  }).promise();
  const queueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await aws.sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: queueArn
  }).promise();

  await aws.sns().confirmSubscription({
    TopicArn: TopicArn,
    Token: SubscriptionArn
  }).promise();

  // Configure the test data

  t.context.granuleId = randomString();
  t.context.pdrName = randomString();

  t.context.cumulusMessage = {
    meta: {
      provider: {
        protocol: 'https',
        host: 'example.com',
        port: 80
      }
    },
    cumulus_meta: {
      execution_name: randomString(),
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine'
    },
    payload: {
      granules: [
        {
          granuleId: t.context.granuleId,
          files: []
        }
      ],
      pdr: {
        name: t.context.pdrName
      }
    }
  };

  t.context.executionEvent = {
    detail: {
      status: 'RUNNING',
      input: JSON.stringify(t.context.cumulusMessage)
    }
  };
});

test.afterEach.always(async (t) => {
  const {
    granuleSnsTopicArnEnvVarBefore,
    pdrSnsTopicArnEnvVarBefore,
    QueueUrl,
    TopicArn
  } = t.context;

  process.env.granule_sns_topic_arn = granuleSnsTopicArnEnvVarBefore;
  process.env.pdr_sns_topic_arn = pdrSnsTopicArnEnvVarBefore;

  await aws.sqs().deleteQueue({ QueueUrl }).promise()
    .catch(noop);
  await aws.sns().deleteTopic({ TopicArn }).promise()
    .catch(noop);
});

test.after.always(() => revertPublishReports());

test.serial('handler() publishes a PDR and a granule to SNS', async (t) => {
  const {
    granuleId, pdrName, QueueUrl, executionEvent
  } = t.context;

  await publishReports.handler(executionEvent);

  await testMessagesReceived(t, QueueUrl, granuleId, pdrName);
});

test.serial('publishReportSnsMessages() publishes a PDR and a granule to SNS', async (t) => {
  const {
    granuleId, pdrName, QueueUrl, cumulusMessage
  } = t.context;

  await publishReports.publishReportSnsMessages(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, granuleId, pdrName);
});
