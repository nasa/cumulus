'use strict';

const sinon = require('sinon');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const { SQS } = require('@cumulus/ingest/aws');
const { s3, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const { getRules, handler } = require('../../lambdas/message-consumer');
const Collection = require('../../models/collections');
const Rule = require('../../models/rules');
const Provider = require('../../models/providers');
const testCollectionName = 'test-collection';

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
        MessageAttributes: {}
      }
    }
  ]
};

const collection = {
  name: testCollectionName,
  version: '0.0.0'
};
const provider = { id: 'PROV1' };

const workflows = [
  'test-workflow-1',
  'test-workflow-2'
];

const commonRuleParams = {
  collection,
  provider: provider.id,
  rule: {
    type: 'sns',
    value: snsArn
  },
  state: 'ENABLED'
};

const rule1Params = Object.assign({}, commonRuleParams, {
  name: 'testRule1',
  workflow: workflows[0]
});

const rule2Params = Object.assign({}, commonRuleParams, {
  name: 'testRule2',
  workflow: workflows[1]
});

const disabledRuleParams = Object.assign({}, commonRuleParams, {
  name: 'disabledRule',
  workflow: workflows[0],
  state: 'DISABLED'
});

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

let sfSchedulerSpy;
const stubQueueUrl = 'stubQueueUrl';

let ruleModel;
test.before(async () => {
  process.env.CollectionsTable = randomString();
  process.env.ProvidersTable = randomString();
  process.env.RulesTable = randomString();
  ruleModel = new Rule();
  await ruleModel.createTable();
  sinon.stub(ruleModel, 'addSnsTrigger');
  sinon.stub(ruleModel, 'deleteSnsTrigger');
});

test.beforeEach(async (t) => {
  t.context.tableName = process.env.RulesTable;
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  process.env.messageConsumer = randomString();

  sfSchedulerSpy = sinon.stub(SQS, 'sendMessage').returns(true);

  t.context.templateBucket = process.env.system_bucket;
  const messageTemplateKey = `${process.env.stackName}/workflows/template.json`;
  const workflowListKey = `${process.env.stackName}/workflows/list.json`;

  t.context.messageTemplateKey = messageTemplateKey;
  t.context.messageTemplate = {
    meta: { queues: { startSF: stubQueueUrl } }
  };
  t.context.workflowList = workflows.map((workflow) => ({
    name: workflow,
    arn: `arn:${workflow}`,
    template: `s3://${t.context.templateBucket}/${messageTemplateKey}`,
    definition: {}
  }));

  await s3().createBucket({ Bucket: t.context.templateBucket }).promise();
  await Promise.all([
    s3().putObject({
      Bucket: t.context.templateBucket,
      Key: messageTemplateKey,
      Body: JSON.stringify(t.context.messageTemplate)
    }).promise(),
    s3().putObject({
      Bucket: t.context.templateBucket,
      Key: workflowListKey,
      Body: JSON.stringify(t.context.workflowList)
    }).promise()
  ]);

  sinon.stub(Provider.prototype, 'get').returns(provider);
  sinon.stub(Collection.prototype, 'get').returns(collection);

  await Promise.all([rule1Params, rule2Params, disabledRuleParams]
    .map((rule) => ruleModel.create(rule)));
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.templateBucket);
  sfSchedulerSpy.restore();
  Provider.prototype.get.restore();
  Collection.prototype.get.restore();
});

test.after.always(async () => {
  await ruleModel.deleteTable();
  ruleModel.addSnsTrigger.restore();
  ruleModel.deleteSnsTrigger.restore();
});

// getKinesisRule tests
test.serial('it should look up sns-type rules which are associated with the collection, but not those that are disabled', async (t) => {
  await getRules(snsArn, 'sns')
    .then((result) => {
      t.is(result.length, 2);
    });
});

// handler tests
test.serial('it should enqueue a message for each associated workflow', async (t) => {
  await handler(event, {}, testCallback);
  t.is(sfSchedulerSpy.callCount, 2);
  const actualQueueUrl = sfSchedulerSpy.getCall(0).args[0];
  t.is(actualQueueUrl, stubQueueUrl);
  const actualMessage = sfSchedulerSpy.getCall(0).args[1];
  const expectedMeta = {
    queues: { startSF: stubQueueUrl },
    provider,
    collection,
    snsSourceArn: snsArn,
    workflow_name: actualMessage.meta.workflow_name
  };
  const expectedPayload = JSON.parse(messageBody);
  const stateMachines = workflows.map((wf) => `arn:${wf}`);
  t.true(stateMachines.includes((actualMessage.cumulus_meta.state_machine)));
  t.true(workflows.includes(actualMessage.meta.workflow_name));
  t.deepEqual(actualMessage.meta, expectedMeta);
  t.deepEqual(actualMessage.payload, expectedPayload);
});
