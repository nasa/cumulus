'use strict';

const test = require('ava');
const sinon = require('sinon');

const aws = require('@cumulus/common/aws');

const { randomString } = require('@cumulus/common/test-utils');
const { handler } = require('../../lambdas/publish-reports');

let snsStub;
let snsPublishSpy;
const sfEventSource = 'aws.states';

const createCloudwatchEventMessage = ({
  message,
  status,
  source = sfEventSource
}) => {
  const messageString = JSON.stringify(message);
  const detail = (status === 'SUCCEEDED'
    ? { status, output: messageString }
    : { status, input: messageString });
  return { source, detail };
};

test.before(async () => {
  snsStub = sinon.stub(aws, 'sns').returns({
    publish: () => ({
      promise: () => Promise.resolve()
    })
  });

  snsPublishSpy = sinon.spy(aws.sns(), 'publish');
});

test.beforeEach((t) => {
  process.env.execution_sns_topic_arn = randomString();
  process.env.granule_sns_topic_arn = randomString();
  process.env.pdr_sns_topic_arn = randomString();

  t.context.snsTopicArns = [
    process.env.execution_sns_topic_arn,
    process.env.granule_sns_topic_arn,
    process.env.pdr_sns_topic_arn
  ];

  t.context.message = {
    cumulus_meta: {
      execution_name: randomString()
    }
  };
  snsPublishSpy.resetHistory();
});

test.after.always(async () => {
  snsStub.restore();
});

test.serial('lambda publishes successful report to all SNS topics', async (t) => {
  const { message, snsTopicArns } = t.context;
  const cwEventMessage = createCloudwatchEventMessage({
    message,
    status: 'SUCCEEDED'
  });

  await handler(cwEventMessage);

  t.is(snsPublishSpy.callCount, 3);
  const expectedMessage = {
    ...message,
    meta: {
      status: 'completed'
    }
  };

  t.deepEqual(JSON.parse(snsPublishSpy.args[0][0].Message), expectedMessage);
  t.true(snsTopicArns.includes(snsPublishSpy.args[0][0].TopicArn));
  t.true(snsTopicArns.includes(snsPublishSpy.args[1][0].TopicArn));
  t.true(snsTopicArns.includes(snsPublishSpy.args[2][0].TopicArn));
});

test.serial('lambda publishes running report to all SNS topics', async (t) => {
  const { message, snsTopicArns } = t.context;
  const cwEventMessage = createCloudwatchEventMessage({
    message,
    status: 'RUNNING'
  });

  await handler(cwEventMessage);

  t.is(snsPublishSpy.callCount, 3);
  const expectedMessage = {
    ...message,
    meta: {
      status: 'running'
    }
  };

  t.deepEqual(JSON.parse(snsPublishSpy.args[0][0].Message), expectedMessage);
  t.true(snsTopicArns.includes(snsPublishSpy.args[0][0].TopicArn));
  t.true(snsTopicArns.includes(snsPublishSpy.args[1][0].TopicArn));
  t.true(snsTopicArns.includes(snsPublishSpy.args[2][0].TopicArn));
});

test.serial('publish failure to executions topic does not affect publishing to other topics', async (t) => {
  // delete env var to cause failure publishing to executions topic
  delete process.env.execution_sns_topic_arn;

  const { message } = t.context;
  const cwEventMessage = createCloudwatchEventMessage({
    message,
    status: 'RUNNING'
  });

  await handler(cwEventMessage);

  t.is(snsPublishSpy.callCount, 2);
});
