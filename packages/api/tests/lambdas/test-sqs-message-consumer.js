'use strict';

const sinon = require('sinon');
const test = require('ava');
const range = require('lodash/range');

const SQS = require('@cumulus/aws-client/SQS');
const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  getJsonS3Object,
} = require('@cumulus/aws-client/S3');
const { sleep } = require('@cumulus/common');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { getS3KeyForArchivedMessage } = require('@cumulus/ingest/sqs');
const { getQueueNameFromUrl } = require('@cumulus/aws-client/SQS');

const { fakeRuleFactoryV2, createSqsQueues, getSqsQueueMessageCounts } = require('../../lib/testUtils');
const rulesHelpers = require('../../lib/rulesHelpers');

const {
  handler,
} = require('../../lambdas/sqs-message-consumer');

process.env.stackName = randomString();
process.env.system_bucket = randomString();

const workflow = randomString();
const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

const event = { messageLimit: 10, timeLimit: 100 };

async function createRulesAndQueues(ruleMeta, queueMaxReceiveCount) {
  const queues = await Promise.all(range(2).map(
    () => createSqsQueues(randomString(), queueMaxReceiveCount)
  ));
  const rules = [
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
  return { rules, queues };
}

async function cleanupQueues(queues) {
  // Delete queueName for each object in list
  queues.forEach((q) => delete q.queueName);

  await Promise.all(
    queues.map(async (queue) => {
      await SQS.deleteQueue(queue.queueUrl);
      await SQS.deleteQueue(queue.deadLetterQueueUrl);
    })
  );
}

test.before(async () => {
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
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.beforeEach((t) => {
  t.context.queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');
  t.context.fetchRulesStub = sinon.stub(rulesHelpers, 'fetchRules').returns([]);
});

test.afterEach.always((t) => {
  t.context.queueMessageStub.restore();
  t.context.fetchRulesStub.restore();
  delete process.env.allowProviderMismatchOnRuleFilter;
});

test.serial('processQueues does nothing when there is no message', async (t) => {
  const { queueMessageStub } = t.context;
  await createRulesAndQueues();
  await handler(event);
  t.is(queueMessageStub.notCalled, true);
});

test.serial('processQueues does nothing when queue does not exist', async (t) => {
  const { queueMessageStub } = t.context;
  await handler(event);
  t.is(queueMessageStub.notCalled, true);
});

test.serial('processQueues does nothing when no rule matches collection in message', async (t) => {
  const { queueMessageStub } = t.context;

  const queue = await createSqsQueues(randomId('queue'));
  const collection = {
    name: randomId('col'),
    version: '1.0.0',
  };
  const rule = fakeRuleFactoryV2({
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
  });
  t.context.fetchRulesStub.returns([rule]);

  await SQS.sendSQSMessage(
    queue.queueUrl,
    { collection }
  );
  await handler(event);

  t.is(queueMessageStub.notCalled, true);
  t.teardown(async () => {
    await cleanupQueues([queue]);
  });
});

test.serial('processQueues processes messages from the ENABLED sqs rule', async (t) => {
  const { queueMessageStub } = t.context;
  const { rules, queues } = await createRulesAndQueues();
  t.context.fetchRulesStub.callsFake((params) => {
    t.deepEqual(params, { queryParams: { 'rule.type': 'sqs', state: 'ENABLED' } });
    return rules.filter((rule) => rule.state === 'ENABLED');
  });
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
    await cleanupQueues(queues);
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
  t.context.fetchRulesStub.returns(rules.filter((rule) => rule.state === 'ENABLED'));

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
    await sleep((visibilityTimeout + 1) * 1000);
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
    await cleanupQueues(queues);
  });
});

test.serial('messages are not retried if retries is set to zero in the rule configuration', async (t) => {
  const { queueMessageStub } = t.context;
  // set visibilityTimeout to 5s so the message is available 5s after retrieval
  const visibilityTimeout = 5;
  const queueMaxReceiveCount = 3;

  const { rules, queues } = await createRulesAndQueues(
    { visibilityTimeout, retries: 0 },
    queueMaxReceiveCount
  );
  t.context.fetchRulesStub.returns(rules.filter((rule) => rule.state === 'ENABLED'));

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
    await sleep((visibilityTimeout + 1) * 1000);
    await handler(event);
  }
  /* eslint-enable no-await-in-loop */

  // the retries is 0, so each message can only be scheduled for workflow execution once
  t.is(queueMessageStub.callCount, 2);
  t.is(queueMessageFromEnabledRuleStub.callCount, 2);

  // messages are picked up from the source queue
  const numberOfMessages = await getSqsQueueMessageCounts(queues[0].queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);

  // messages are moved to dead-letter queue after `queueMaxReceiveCount` retries
  const numberOfMessagesDLQ = await getSqsQueueMessageCounts(queues[0].deadLetterQueueUrl);
  t.is(numberOfMessagesDLQ.numberOfMessagesAvailable, 2);

  t.teardown(async () => {
    await cleanupQueues(queues);
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
  t.context.fetchRulesStub.returns([rule]);

  await SQS.sendSQSMessage(
    queue.queueUrl,
    { foo: 'bar' }
  );

  await handler(event);

  // Should queue message for enabled rule
  t.is(queueMessageStub.callCount, 1);

  t.teardown(async () => {
    await cleanupQueues([queue]);
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
  t.context.fetchRulesStub.returns(rules.filter((rule) => rule.state === 'ENABLED'));

  await SQS.sendSQSMessage(
    queue.queueUrl,
    { collection } // include collection in message
  );

  await handler(event);

  // Should only queue message for the workflow on the rule matching the collection in the event
  t.is(queueMessageStub.callCount, 1);

  t.teardown(async () => {
    await cleanupQueues([queue]);
  });
});

test.serial('SQS message consumer queues correct number of workflows for rules matching the event provider', async (t) => {
  const { queueMessageStub } = t.context;

  const queue = await createSqsQueues(randomId('queue'));
  const provider = randomId('provider');
  // Set visibility timeout to 0 for testing to ensure that message is
  // read when processing all rules
  const visibilityTimeout = 0;
  const rules = [
    fakeRuleFactoryV2({
      name: randomId('matchingRule'),
      provider,
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
  t.context.fetchRulesStub.returns(rules.filter((rule) => rule.state === 'ENABLED'));

  await SQS.sendSQSMessage(
    queue.queueUrl,
    { provider }
  );

  await handler(event);

  t.is(queueMessageStub.callCount, 1);

  t.teardown(async () => {
    await cleanupQueues([queue]);
  });
});

test.serial('SQS message consumer queues correct number of workflows for rules not matching the event provider when lambda var allowProviderMismatchOnRuleFilter is set to true', async (t) => {
  const { queueMessageStub } = t.context;
  process.env.allowProviderMismatchOnRuleFilter = true;
  const queue = await createSqsQueues(randomId('queue'));
  const provider = randomId('provider');
  const provider2 = randomId('provider2');
  // Set visibility timeout to 0 for testing to ensure that message is
  // read when processing all rules
  const visibilityTimeout = 0;
  const rules = [
    fakeRuleFactoryV2({
      name: randomId('matchingRule'),
      provider,
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
  t.context.fetchRulesStub.returns(rules.filter((rule) => rule.state === 'ENABLED'));

  await SQS.sendSQSMessage(
    queue.queueUrl,
    { provider2 }
  );

  await handler(event);

  t.is(queueMessageStub.callCount, 2);

  t.teardown(async () => {
    await cleanupQueues([queue]);
    delete process.env.allowProviderMismatchOnRuleFilter;
  });
});

test.serial('processQueues archives messages from the ENABLED sqs rule only', async (t) => {
  const { stackName } = process.env;
  const { rules, queues } = await createRulesAndQueues();
  t.context.fetchRulesStub.callsFake((params) => {
    t.deepEqual(params, { queryParams: { 'rule.type': 'sqs', state: 'ENABLED' } });
    return rules.filter((rule) => rule.state === 'ENABLED');
  });
  const message = { testdata: randomString() };

  // Send message to ENABLED queue
  const firstMessage = await SQS.sendSQSMessage(
    queues[0].queueUrl,
    message
  );

  // Send message to DISABLED queue
  const secondMessage = await SQS.sendSQSMessage(
    queues[1].queueUrl,
    { testdata: randomString() }
  );

  const firstMessageId = firstMessage.MessageId;
  const secondMessageId = secondMessage.MessageId;

  const enabledQueueName = getQueueNameFromUrl(queues[0].queueUrl);
  const disabledQueueName = getQueueNameFromUrl(queues[1].queueUrl);

  const enabledQueueKey = getS3KeyForArchivedMessage(stackName, firstMessageId, enabledQueueName);
  const deadLetterKey = getS3KeyForArchivedMessage(stackName, secondMessageId, disabledQueueName);

  await handler(event);

  const objJson = await getJsonS3Object(process.env.system_bucket, enabledQueueKey);
  t.deepEqual(message, objJson);

  t.false(await s3ObjectExists({
    Bucket: process.env.system_bucket,
    Key: deadLetterKey,
  }));

  t.teardown(async () => {
    await cleanupQueues(queues);
  });
});

test.serial('processQueues archives multiple messages', async (t) => {
  const { stackName } = process.env;
  const { rules, queues } = await createRulesAndQueues();
  t.context.fetchRulesStub.returns(rules.filter((rule) => rule.state === 'ENABLED'));

  // Send message to ENABLED queue
  const messages = await Promise.all(
    range(4).map(() =>
      SQS.sendSQSMessage(
        queues[0].queueUrl,
        { testdata: randomString() }
      ))
  );
  const queueName = getQueueNameFromUrl(queues[0].queueUrl);
  const deriveKey = (m) => getS3KeyForArchivedMessage(stackName, m.MessageId, queueName);
  const keys = messages.map((m) => deriveKey(m));

  await handler(event);

  const items = await Promise.all(keys.map((k) =>
    s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: k,
    })));

  const itemExists = (i) => t.true(i);

  items.every(itemExists);

  t.teardown(async () => {
    await cleanupQueues(queues);
  });
});
