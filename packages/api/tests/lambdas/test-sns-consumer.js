'use strict';

const get = require('lodash/get');
const sinon = require('sinon');
const test = require('ava');

const SQS = require('@cumulus/aws-client/SQS');
const { randomString } = require('@cumulus/common/test-utils');
const { handler } = require('../../lambdas/message-consumer');
const Collection = require('../../models/collections');
const Rule = require('../../models/rules');
const Provider = require('../../models/providers');
const testCollectionName = 'test-collection';

/**
 * Callback used for testing
 *
 * @param {*} err - error
 * @param {Object} object - object
 * @returns {Object} object, if no error is thrown
 */
function testCallback(err, object) {
  if (err) throw err;
  return object;
}

const snsArn = 'test-SnsArn';
const messageBody = '{"Data":{}}';

const event = {
  Records: [
    {
      EventSource: 'aws:sns',
      EventVersion: '1.0',
      EventSubscriptionArn: 'arn:aws:sns:us-east-1:00000000000:gdelt-csv:111111-111',
      Sns: {
        Type: 'Notification',
        MessageId: '4f411981',
        TopicArn: snsArn,
        Subject: 'Amazon S3 Notification',
        Message: messageBody,
        MessageAttributes: {},
      },
    },
  ],
};

const collection = {
  name: testCollectionName,
  version: '0.0.0',
};
const provider = { id: 'PROV1' };

const stubQueueUrl = 'stubQueueUrl';
let ruleModel;
let sandbox;
let sfSchedulerSpy;

test.before(async () => {
  process.env.CollectionsTable = randomString();
  process.env.ProvidersTable = randomString();
  process.env.RulesTable = randomString();
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  process.env.messageConsumer = randomString();

  ruleModel = new Rule();
  await ruleModel.createTable();

  sandbox = sinon.createSandbox();
  sandbox.stub(ruleModel, 'addSnsTrigger');
  sandbox.stub(ruleModel, 'deleteSnsTrigger');
});

test.beforeEach(async (t) => {
  t.context.templateBucket = randomString();
  t.context.workflow = randomString();
  t.context.stateMachineArn = randomString();
  t.context.messageTemplate = {
    meta: { queues: { startSF: stubQueueUrl } },
  };
  const workflowDefinition = {
    name: t.context.workflow,
    arn: t.context.stateMachineArn,
  };

  sfSchedulerSpy = sandbox.stub(SQS, 'sendSQSMessage').returns(true);

  sandbox.stub(Rule, 'buildPayload').callsFake((item) => Promise.resolve({
    template: t.context.messageTemplate,
    provider: item.provider,
    collection: item.collection,
    meta: get(item, 'meta', {}),
    payload: get(item, 'payload', {}),
    definition: workflowDefinition,
  }));
  sandbox.stub(Provider.prototype, 'get').resolves(provider);
  sandbox.stub(Collection.prototype, 'get').resolves(collection);
});

test.afterEach.always(async () => {
  sfSchedulerSpy.resetHistory();
});

test.after.always(async () => {
  await ruleModel.deleteTable();
  sandbox.restore();
});

// handler tests
test.serial('it should enqueue a message for each associated workflow', async (t) => {
  const rule1 = {
    name: 'testRule1',
    collection,
    provider: provider.id,
    rule: {
      type: 'sns',
      value: snsArn,
    },
    state: 'ENABLED',
    workflow: 'test-workflow-1',
  };

  await ruleModel.create(rule1);
  await handler(event, {}, testCallback);

  const actualQueueUrl = sfSchedulerSpy.getCall(0).args[0];
  t.is(actualQueueUrl, stubQueueUrl);
  const actualMessage = sfSchedulerSpy.getCall(0).args[1];
  const expectedMessage = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn,
    },
    meta: {
      queues: { startSF: stubQueueUrl },
      provider,
      collection,
      snsSourceArn: snsArn,
      workflow_name: t.context.workflow,
    },
    payload: JSON.parse(messageBody),
  };
  t.is(actualMessage.cumulus_meta.state_machine, expectedMessage.cumulus_meta.state_machine);
  t.deepEqual(actualMessage.meta, expectedMessage.meta);
  t.deepEqual(actualMessage.payload, expectedMessage.payload);
});
