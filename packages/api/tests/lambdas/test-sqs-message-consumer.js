'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');
const range = require('lodash.range');

const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');
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
let queueUrls = [];
let createdRules = [];
const event = { messageLimit: 10, timeLimit: 100 };
const queueMessageStub = sinon.stub(rulesHelpers, 'queueMessageForRule');

async function createRules() {
  queueUrls = await Promise.all(range(2).map(() => aws.createQueue(randomString())));
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
        value: queueUrls[0]
      },
      state: 'ENABLED'
    }),
    fakeRuleFactoryV2({
      workflow,
      rule: {
        type: 'sqs',
        value: queueUrls[1]
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
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  
  await Promise.all([
    aws.s3PutObject({
      Bucket: process.env.system_bucket,
      Key: messageTemplateKey,
      Body: JSON.stringify({meta: 'testmeta'})
    }),
    aws.s3PutObject({
    Bucket: process.env.system_bucket,
    Key: workflowfile,
    Body: JSON.stringify({ testworkflow: 'workflowconfig' })
    })
  ]);
  createdRules = await createRules();
});

test.after.always(async () => {
  // cleanup table
  await rulesModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
  await Promise.all(
    queueUrls.map((queueUrl) => aws.sqs().deleteQueue({ QueueUrl: queueUrl }).promise())
  );
  queueMessageStub.restore();
});

test.afterEach.always(() => {
  queueMessageStub.resetHistory();
});

test.serial('processQueues does nothing when there is no message', async (t) => {
  await processQueues(event, dispatch);
  t.is(queueMessageStub.notCalled, true);
});

test.serial('processQueues processes messages from the ENABLED sqs rule', async (t) => {
  const queueMessageFromEnabledRuleStub = queueMessageStub
    .withArgs(createdRules[1], sinon.match.any);

  // send two messages to the queue of the ENABLED sqs rule
  await Promise.all(
    range(2).map(() =>
      aws.sqs().sendMessage(
        { QueueUrl: queueUrls[0], MessageBody: JSON.stringify({ testdata: randomString() }) }
      ).promise())
  );

  // send three messages to the queue of the DISABLED sqs rule
  await Promise.all(
    range(3).map(() =>
      aws.sqs().sendMessage(
        { QueueUrl: queueUrls[1], MessageBody: JSON.stringify({ testdata: randomString() }) }
      ).promise())
  );
  await processQueues(event, dispatch);

  // verify only messages from ENABLED rule are processed
  t.is(queueMessageStub.calledTwice, true);
  t.is(queueMessageFromEnabledRuleStub.calledTwice, true);

  // messages are picked up from the correct queue
  const sqsOptions = { numOfMessages: 10, timeout: 40, waitTimeSeconds: 2 };
  const messagesFromQueue0 = await aws.receiveSQSMessages(queueUrls[0], sqsOptions);
  t.is(messagesFromQueue0.length, 0);
  const messagesFromQueue1 = await aws.receiveSQSMessages(queueUrls[1], sqsOptions);
  t.is(messagesFromQueue1.length, 3);
});
