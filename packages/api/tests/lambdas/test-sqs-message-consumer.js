'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');
const range = require('lodash.range');

const awsServices = require('@cumulus/aws-client/services');
const {
  s3PutObject,
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { sleep } = require('@cumulus/common/util');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const { fakeRuleFactoryV2, createSqsQueues, getSqsQueueMessageCounts } = require('../../lib/testUtils');
const rulesHelpers = require('../../lib/rulesHelpers');

const sqsMessageConsumer = rewire('../../lambdas/sqs-message-consumer');
const processQueues = sqsMessageConsumer.__get__('processQueues');
const dispatch = sqsMessageConsumer.__get__('dispatch');

process.env.RulesTable = `RulesTable_${randomString()}`;
process.env.stackName = randomString();
process.env.system_bucket = randomString();

const workflow = randomString();
const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

let rulesModel;
let sqsQueues = [];
let createdRules = [];
const event = { messageLimit: 10, timeLimit: 100 };

async function createRules(meta) {
  sqsQueues = await Promise.all(range(2).map(() => createSqsQueues(randomString())));
  const rules = [
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'onetime'
      },
      state: 'ENABLED'
    }),
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'sqs',
        value: sqsQueues[0].queueUrl
      },
      meta: {
        visibilityTimeout: 120,
        ...meta
      },
      state: 'ENABLED'
    }),
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'sqs',
        value: sqsQueues[1].queueUrl
      },
      meta: {
        visibilityTimeout: 120,
        ...meta
      },
      state: 'DISABLED'
    })
  ];

  return Promise.all(
    rules.map((rule) => rulesModel.create(rule))
  );
}

test.before(async () => {
  // create Rules table
  rulesModel = new models.Rule();
  await rulesModel.createTable();
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  await Promise.all([
    s3PutObject({
      Bucket: process.env.system_bucket,
      Key: messageTemplateKey,
      Body: JSON.stringify({ meta: 'testmeta' })
    }),
    s3PutObject({
      Bucket: process.env.system_bucket,
      Key: workflowfile,
      Body: JSON.stringify({ testworkflow: 'workflowconfig' })
    })
  ]);
});

test.after.always(async () => {
  // cleanup table
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.afterEach.always(async () => {
  await Promise.all(
    createdRules.map((rule) => rulesModel.delete(rule))
  );

  const queueUrls = sqsQueues.reduce(
    (accumulator, currentValue) => accumulator.concat(Object.values(currentValue)), []
  );

  await Promise.all(
    queueUrls.map((queueUrl) => awsServices.sqs().deleteQueue({ QueueUrl: queueUrl }).promise())
  );
});

test.serial('processQueues does nothing when there is no message', async (t) => {
  const queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');
  await processQueues(event, dispatch);
  t.is(queueMessageStub.notCalled, true);
  queueMessageStub.restore();
});

test.serial('processQueues processes messages from the ENABLED sqs rule', async (t) => {
  createdRules = await createRules();
  const queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');
  const queueMessageFromEnabledRuleStub = queueMessageStub
    .withArgs(createdRules[1], sinon.match.any, sinon.match.any);

  // send two messages to the queue of the ENABLED sqs rule
  await Promise.all(
    range(2).map(() =>
      awsServices.sqs().sendMessage({
        QueueUrl: sqsQueues[0].queueUrl, MessageBody: JSON.stringify({ testdata: randomString() })
      }).promise())
  );

  // send three messages to the queue of the DISABLED sqs rule
  await Promise.all(
    range(3).map(() =>
      awsServices.sqs().sendMessage({
        QueueUrl: sqsQueues[1].queueUrl, MessageBody: JSON.stringify({ testdata: randomString() })
      }).promise())
  );
  await processQueues(event, dispatch);

  // verify only messages from ENABLED rule are processed
  t.is(queueMessageStub.calledTwice, true);
  t.is(queueMessageFromEnabledRuleStub.calledTwice, true);
  queueMessageStub.resetHistory();

  // messages are not processed multiple times in parallel
  // given the visibilityTimeout is long enough
  await processQueues(event, dispatch);
  t.is(queueMessageStub.notCalled, true);
  t.is(queueMessageFromEnabledRuleStub.notCalled, true);

  // messages are picked up from the correct queue
  const numberOfMessages = await getSqsQueueMessageCounts(sqsQueues[0].queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);

  const numberOfMessagesQueue1 = await getSqsQueueMessageCounts(sqsQueues[1].queueUrl);
  t.is(numberOfMessagesQueue1.numberOfMessagesAvailable, 3);

  // processed messages stay in queue until workflow execution succeeds
  // in this test, workflow executions are stubbed
  t.is(numberOfMessages.numberOfMessagesNotVisible, 2);
  queueMessageStub.restore();
});

test.serial('messages failed to be processed are retried', async (t) => {
  // set visibilityTimeout to 5s so the message is available 5s after retrieval
  createdRules = await createRules({ visibilityTimeout: 5, retries: 1 });
  const queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');
  const queueMessageFromEnabledRuleStub = queueMessageStub
    .withArgs(createdRules[1], sinon.match.any, sinon.match.any);

  // send two messages to the queue of the ENABLED sqs rule
  await Promise.all(
    range(2).map(() =>
      awsServices.sqs().sendMessage({
        QueueUrl: sqsQueues[0].queueUrl, MessageBody: JSON.stringify({ testdata: randomString() })
      }).promise())
  );

  await processQueues(event, dispatch);

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < 3; i += 1) {
    await sleep(5 * 1000);
    await processQueues(event, dispatch);
  }
  /* eslint-enable no-await-in-loop */

  // the retries is 1, so each message can only be scheduled for workflow execution twice
  t.is(queueMessageStub.callCount, 4);
  t.is(queueMessageFromEnabledRuleStub.callCount, 4);
  queueMessageStub.resetHistory();

  // messages are picked up from the source queue
  const numberOfMessages = await getSqsQueueMessageCounts(sqsQueues[0].queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);

  // messages are moved to dead-letter queue after retries
  const numberOfMessagesDLQ = await getSqsQueueMessageCounts(sqsQueues[0].deadLetterQueueUrl);
  t.is(numberOfMessagesDLQ.numberOfMessagesAvailable, 2);

  queueMessageStub.restore();
});
