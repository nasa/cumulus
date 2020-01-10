'use strict';

const test = require('ava');
const rewire = require('rewire');

const awsServices = require('@cumulus/aws-client/services');
const { noop } = require('@cumulus/common/util');
const { randomString } = require('@cumulus/common/test-utils');

const publishReports = rewire('../../../lambdas/publish-reports');

const testMessagesReceived = async (t, QueueUrl, granuleId, pdrName) => {
  const { Messages } = await awsServices.sqs().receiveMessage({
    QueueUrl,
    WaitTimeSeconds: 3,
    MaxNumberOfMessages: 2
  }).promise();

  if (granuleId && pdrName) t.is(Messages.length, 2);
  else if (granuleId || pdrName) t.is(Messages.length, 1);
  else t.is(Messages, undefined);

  if (granuleId || pdrName) {
    const snsMessages = Messages.map((message) => JSON.parse(message.Body));
    const dbRecords = snsMessages.map((message) => JSON.parse(message.Message));

    if (granuleId) {
      const granuleRecord = dbRecords.find((r) => r.granuleId);
      t.is(granuleRecord.granuleId, granuleId);
    }

    if (pdrName) {
      const pdrRecord = dbRecords.find((r) => r.pdrName);
      t.is(pdrRecord.pdrName, pdrName);
    }
  }
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
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: topicName
  }).promise();
  t.context.TopicArn = TopicArn;
  process.env.granule_sns_topic_arn = TopicArn;
  process.env.pdr_sns_topic_arn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await awsServices.sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;

  const getQueueAttributesResponse = await awsServices.sqs().getQueueAttributes({
    QueueUrl: QueueUrl,
    AttributeNames: ['QueueArn']
  }).promise();
  const queueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await awsServices.sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: queueArn
  }).promise();

  await awsServices.sns().confirmSubscription({
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

  await awsServices.sqs().deleteQueue({ QueueUrl }).promise()
    .catch(noop);
  await awsServices.sns().deleteTopic({ TopicArn }).promise()
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

test.serial('publishReportSnsMessages() publishes a granule to SNS even if publishing the PDR fails', async (t) => {
  const {
    granuleId, QueueUrl, cumulusMessage
  } = t.context;

  delete cumulusMessage.payload.pdr.name;

  await publishReports.publishReportSnsMessages(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, granuleId, null);
});

test.serial('publishReportSnsMessages() publishes a PDR to SNS even if publishing the granule fails', async (t) => {
  const {
    pdrName, QueueUrl, cumulusMessage
  } = t.context;

  delete cumulusMessage.payload.granules[0].granuleId;

  await publishReports.publishReportSnsMessages(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, null, pdrName);
});

test.serial('publishGranuleRecord() publishes a granule record to SNS', async (t) => {
  const { granuleId, QueueUrl } = t.context;

  await publishReports.publishGranuleRecord({ granuleId });

  await testMessagesReceived(t, QueueUrl, granuleId, null);
});

test.serial('publishGranuleRecord() does not throw an exception if publishing the granule record to SNS fails', async (t) => {
  const { granuleId } = t.context;

  await t.notThrowsAsync(
    () => publishReports.__with__({
      publishSnsMessage: () => Promise.reject(new Error('nope'))
    })(() => publishReports.publishGranuleRecord({ granuleId }))
  );
});

test.serial('handleGranuleMessages() publishes a granule record to SNS', async (t) => {
  const { cumulusMessage, granuleId, QueueUrl } = t.context;

  await publishReports.handleGranuleMessages(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, granuleId, null);
});

test.serial('handlePdrMessage() publishes a PDR record to SNS', async (t) => {
  const { cumulusMessage, pdrName, QueueUrl } = t.context;

  delete cumulusMessage.payload.granules;

  await publishReports.handlePdrMessage(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, null, pdrName);
});

test.serial('handlePdrMessage() does not publish a PDR record to SNS if the Cumulus message does not contain a PDR', async (t) => {
  const { cumulusMessage, QueueUrl } = t.context;

  delete cumulusMessage.payload.pdr;

  await publishReports.handlePdrMessage(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, null, null);
});

test.serial('handlePdrMessage() does not throw an exception if generating the PDR record fails', async (t) => {
  const { cumulusMessage } = t.context;

  delete cumulusMessage.payload.pdr.name;

  await t.notThrowsAsync(
    () => publishReports.__with__({
      publishSnsMessage: () => Promise.reject(new Error('nope'))
    })(() => publishReports.handlePdrMessage(cumulusMessage))
  );
});

test.serial('handlePdrMessage() does not throw an exception if publishing the PDR record to SNS fails', async (t) => {
  const { cumulusMessage } = t.context;

  await t.notThrowsAsync(
    () => publishReports.__with__({
      publishSnsMessage: () => Promise.reject(new Error('nope'))
    })(() => publishReports.handlePdrMessage(cumulusMessage))
  );
});
