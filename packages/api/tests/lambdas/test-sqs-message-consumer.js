'use strict';

const sinon = require('sinon');
const test = require('ava');
const range = require('lodash/range');

const SQS = require('@cumulus/aws-client/SQS');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { sleep } = require('@cumulus/common/util');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const { fakeRuleFactoryV2, createSqsQueues, getSqsQueueMessageCounts } = require('../../lib/testUtils');
const rulesHelpers = require('../../lib/rulesHelpers');

const { handler } = require('../../lambdas/sqs-message-consumer');

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
  await createBucket(process.env.system_bucket);

  await Promise.all([
    putJsonS3Object(
      process.env.system_bucket,
      messageTemplateKey,
      { meta: 'testmeta' }
    ),
    putJsonS3Object(
      process.env.system_bucket,
      workflowfile,
      { testworkflow: 'workflowconfig' }
    )
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
    queueUrls.map((queueUrl) => SQS.deleteQueue(queueUrl))
  );
});

test.serial('processQueues does nothing when there is no message', async (t) => {
  const queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');
  await handler(event);
  t.is(queueMessageStub.notCalled, true);
  t.teardown(() => queueMessageStub.restore());
});

test.serial('processQueues processes messages from the ENABLED sqs rule', async (t) => {
  createdRules = await createRules();
  const queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');
  const queueMessageFromEnabledRuleStub = queueMessageStub
    .withArgs(createdRules[1], sinon.match.any, sinon.match.any);

  // send two messages to the queue of the ENABLED sqs rule
  await Promise.all(
    range(2).map(() =>
      SQS.sendSQSMessage(
        sqsQueues[0].queueUrl,
        { testdata: randomString() }
      ))
  );

  // send three messages to the queue of the DISABLED sqs rule
  await Promise.all(
    range(3).map(() =>
      SQS.sendSQSMessage(
        sqsQueues[1].queueUrl,
        { testdata: randomString() }
      ))
  );
  await handler(event);

  // verify only messages from ENABLED rule are processed
  t.is(queueMessageStub.calledTwice, true);
  t.is(queueMessageFromEnabledRuleStub.calledTwice, true);
  queueMessageStub.resetHistory();

  // messages are not processed multiple times in parallel
  // given the visibilityTimeout is long enough
  await handler(event);
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
  t.teardown(() => queueMessageStub.restore());
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
      SQS.sendSQSMessage(
        sqsQueues[0].queueUrl,
        { testdata: randomString() }
      ))
  );

  await handler(event);

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < 3; i += 1) {
    await sleep(5 * 1000);
    await handler(event);
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

  t.teardown(() => queueMessageStub.restore());
});

test.serial.skip('SQS message consumer only starts workflows for rules matching the event collection', async (t) => {
  const queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');

  // Set visibility timeout to 0 for testing to ensure that message is
  // read when processing all rules
  const { queueUrl } = await createSqsQueues(randomId('queue'), '0');
  const collection = {
    name: randomId('collection'),
    version: '1.0.0'
  };
  const rules = [
    fakeRuleFactoryV2({
      name: randomId('matchingRule'),
      collection,
      rule: {
        type: 'sqs',
        value: queueUrl
      },
      state: 'ENABLED',
      workflow
    }),
    fakeRuleFactoryV2({
      rule: {
        type: 'sqs',
        value: queueUrl
      },
      state: 'ENABLED',
      workflow
    })
  ];

  await Promise.all(rules.map((rule) => rulesModel.create(rule)));
  await SQS.sendSQSMessage(
    queueUrl,
    { testdata: randomString() }
  );

  await handler(event);

  // Should only queue message for the workflow on the rule matching the collection in the event
  t.is(queueMessageStub.callCount, 1);

  t.teardown(async () => {
    await Promise.all(rules.map((rule) => rulesModel.delete(rule)));
  });
});
