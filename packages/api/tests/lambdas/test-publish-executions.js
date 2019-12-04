'use strict';

const test = require('ava');
const { sns, sqs } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { handler } = require('../../lambdas/publish-executions');

test.before(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.execution_sns_topic_arn = TopicArn;

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

test.serial('The test-publish-executions Lambda function takes a DynamoDB stream event with a single record and publishes an execution to SNS', async (t) => {
  const { QueueUrl } = t.context;

  const executionArn = randomString();

  const event = {
    Records: [
      {
        dynamodb: {
          NewImage: {
            arn: { S: executionArn },
            status: { S: 'running' }
          }
        }
      }
    ]
  };

  await handler(event);

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const executionRecord = JSON.parse(snsMessage.Message);

  t.is(executionRecord.arn, executionArn);
  t.is(executionRecord.status, 'running');
});

test.serial('The test-publish-executions Lambda function takes a DynamoDB stream event with a multiple records and publishes their executions to SNS', async (t) => {
  const { QueueUrl } = t.context;

  const event = {
    Records: [
      {
        dynamodb: {
          NewImage: {
            arn: { S: randomString() },
            status: { S: 'running' }
          }
        }
      },
      {
        dynamodb: {
          NewImage: {
            arn: { S: randomString() },
            status: { S: 'running' }
          }
        }
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
