'use strict';

const delay = require('delay');
const sinon = require('sinon');
const test = require('ava');
const range = require('lodash/range');

const SQS = require('@cumulus/aws-client/SQS');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const Rule = require('../../models/rules');
const { fakeRuleFactoryV2, createSqsQueues, getSqsQueueMessageCounts } = require('../../lib/testUtils');
const rulesHelpers = require('../../lib/rulesHelpers');

const {
  handler,
} = require('../../lambdas/sqs-message-consumer');

process.env.RulesTable = `RulesTable_${randomString()}`;
process.env.stackName = randomString();
process.env.system_bucket = randomString();

const workflow = randomString();
const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

let rulesModel;
const event = { messageLimit: 10, timeLimit: 100 };

async function createRulesAndQueues(ruleMeta, queueMaxReceiveCount) {
  const queues = await Promise.all(range(2).map(
    () => createSqsQueues(randomString(), queueMaxReceiveCount)
  ));
  let rules = [
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'onetime',
      },
      state: 'ENABLED',
    }),
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'sqs',
        value: queues[0].queueUrl,
      },
      meta: {
        visibilityTimeout: 120,
        ...ruleMeta,
      },
      state: 'ENABLED',
    }),
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'sqs',
        value: queues[1].queueUrl,
      },
      meta: {
        visibilityTimeout: 120,
        ...ruleMeta,
      },
      state: 'DISABLED',
    }),
  ];
  rules = await Promise.all(
    rules.map((rule) => rulesModel.create(rule))
  );
  return { rules, queues };
}

async function cleanupRulesAndQueues(rules, queues) {
  await Promise.all(
    rules.map((rule) => rulesModel.delete(rule))
  );

  const queueUrls = queues.reduce(
    (accumulator, currentValue) => accumulator.concat(Object.values(currentValue)), []
  );

  await Promise.all(
    queueUrls.map((queueUrl) => SQS.deleteQueue(queueUrl))
  );
}

test.before(async () => {
  // create Rules table
  rulesModel = new Rule();
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
    ),
  ]);
});

test.after.always(async () => {
  // cleanup table
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.beforeEach(async (t) => {
  t.context.queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');
});

test.afterEach.always(async (t) => {
  t.context.queueMessageStub.restore();
});

test.serial('processQueues does nothing when there is no message', async (t) => {
  const { queueMessageStub } = t.context;
  await createRulesAndQueues();
  await handler(event);
  t.is(queueMessageStub.notCalled, true);
});

test.serial('processQueues does nothing when queue does not exist', async (t) => {
  const { queueMessageStub } = t.context;
  const validateSqsRuleStub = sinon.stub(Rule.prototype, 'validateAndUpdateSqsRule')
    .callsFake(async (item) => item);
  await rulesModel.create(fakeRuleFactoryV2({
    workflow,
    rule: {
      type: 'sqs',
      value: 'non-existent-queue',
    },
    state: 'ENABLED',
  }));
  await handler(event);
  t.is(queueMessageStub.notCalled, true);
  t.teardown(() => validateSqsRuleStub.restore());
});

test.serial('processQueues does nothing when no rule matches collection in message', async (t) => {
  const { queueMessageStub } = t.context;

  const queue = await createSqsQueues(randomId('queue'));
  const collection = {
    name: randomId('col'),
    version: '1.0.0',
  };
  const rule = await rulesModel.create(fakeRuleFactoryV2({
    collection: {
      name: 'different-collection',
      version: '1.2.3',
    },
    workflow,
    rule: {
      type: 'sqs',
      value: queue.queueUrl,
    },
    state: 'ENABLED',
  }));

  await SQS.sendSQSMessage(
    queue.queueUrl,
    { collection }
  );
  await handler(event);

  t.is(queueMessageStub.notCalled, true);
  t.teardown(async () => {
    await cleanupRulesAndQueues([rule], [queue]);
  });
});

test.serial('processQueues processes messages from the ENABLED sqs rule', async (t) => {
  const { queueMessageStub } = t.context;
  const { rules, queues } = await createRulesAndQueues();
  const queueMessageFromEnabledRuleStub = queueMessageStub
    .withArgs(rules[1], sinon.match.any, sinon.match.any);

  // send two messages to the queue of the ENABLED sqs rule
  await Promise.all(
    range(2).map(() =>
      SQS.sendSQSMessage(
        queues[0].queueUrl,
        { testdata: randomString() }
      ))
  );

  // send three messages to the queue of the DISABLED sqs rule
  await Promise.all(
    range(3).map(() =>
      SQS.sendSQSMessage(
        queues[1].queueUrl,
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
  const numberOfMessages = await getSqsQueueMessageCounts(queues[0].queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);

  const numberOfMessagesQueue1 = await getSqsQueueMessageCounts(queues[1].queueUrl);
  t.is(numberOfMessagesQueue1.numberOfMessagesAvailable, 3);

  // processed messages stay in queue until workflow execution succeeds
  // in this test, workflow executions are stubbed
  t.is(numberOfMessages.numberOfMessagesNotVisible, 2);
  t.teardown(async () => {
    await cleanupRulesAndQueues(rules, queues);
  });
});

test.serial('messages are retried the correct number of times based on the rule configuration', async (t) => {
  const { queueMessageStub } = t.context;
  // set visibilityTimeout to 5s so the message is available 5s after retrieval
  const visibilityTimeout = 5;
  const queueMaxReceiveCount = 3;

  const { rules, queues } = await createRulesAndQueues(
    { visibilityTimeout, retries: 1 },
    queueMaxReceiveCount
  );

  const queueMessageFromEnabledRuleStub = queueMessageStub
    .withArgs(rules[1], sinon.match.any, sinon.match.any);

  // send two messages to the queue of the ENABLED sqs rule
  await Promise.all(
    range(2).map(() =>
      SQS.sendSQSMessage(
        queues[0].queueUrl,
        { testdata: randomString() }
      ))
  );

  await handler(event);

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < queueMaxReceiveCount; i += 1) {
    await delay(visibilityTimeout * 1000);
    await handler(event);
  }
  /* eslint-enable no-await-in-loop */

  // the retries is 1, so each message can only be scheduled for workflow execution twice
  t.is(queueMessageStub.callCount, 4);
  t.is(queueMessageFromEnabledRuleStub.callCount, 4);

  // messages are picked up from the source queue
  const numberOfMessages = await getSqsQueueMessageCounts(queues[0].queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);

  // messages are moved to dead-letter queue after `queueMaxReceiveCount` retries
  const numberOfMessagesDLQ = await getSqsQueueMessageCounts(queues[0].deadLetterQueueUrl);
  t.is(numberOfMessagesDLQ.numberOfMessagesAvailable, 2);

  t.teardown(async () => {
    await cleanupRulesAndQueues(rules, queues);
  });
});

test.serial('SQS message consumer queues workflow for rule when there is no event collection', async (t) => {
  const { queueMessageStub } = t.context;

  const queue = await createSqsQueues(randomId('queue'));
  const rule = fakeRuleFactoryV2({
    name: randomId('matchingRule'),
    rule: {
      type: 'sqs',
      value: queue.queueUrl,
    },
    state: 'ENABLED',
    workflow,
  });

  const createdRule = await rulesModel.create(rule);
  await SQS.sendSQSMessage(
    queue.queueUrl,
    { foo: 'bar' }
  );

  await handler(event);

  // Should queue message for enabled rule
  t.is(queueMessageStub.callCount, 1);

  t.teardown(async () => {
    await cleanupRulesAndQueues([createdRule], [queue]);
  });
});

test.serial('SQS message consumer queues correct number of workflows for rules matching the event collection', async (t) => {
  const { queueMessageStub } = t.context;

  const queue = await createSqsQueues(randomId('queue'));
  const collection = {
    name: randomId('collection'),
    version: '1.0.0',
  };
  // Set visibility timeout to 0 for testing to ensure that message is
  // read when processing all rules
  const visibilityTimeout = 0;
  const rules = [
    fakeRuleFactoryV2({
      name: randomId('matchingRule'),
      collection,
      rule: {
        type: 'sqs',
        value: queue.queueUrl,
      },
      meta: {
        visibilityTimeout,
      },
      state: 'ENABLED',
      workflow,
    }),
    fakeRuleFactoryV2({
      rule: {
        type: 'sqs',
        value: queue.queueUrl,
      },
      meta: {
        visibilityTimeout,
      },
      state: 'ENABLED',
      workflow,
    }),
  ];

  await Promise.all(rules.map((rule) => rulesModel.create(rule)));
  await SQS.sendSQSMessage(
    queue.queueUrl,
    { collection } // include collection in message
  );

  await handler(event);

  // Should only queue message for the workflow on the rule matching the collection in the event
  t.is(queueMessageStub.callCount, 1);

  t.teardown(async () => {
    await cleanupRulesAndQueues(rules, [queue]);
  });
});
