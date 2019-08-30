'use strict';

const test = require('ava');
const sinon = require('sinon');

const aws = require('@cumulus/common/aws');

const { randomString } = require('@cumulus/common/test-utils');
const { handler } = require('..');

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
  process.env.execution_sns_topic_arn = randomString();
  process.env.granule_sns_topic_arn = randomString();
  process.env.pdr_sns_topic_arn = randomString();

  snsStub = sinon.stub(aws, 'sns').returns({
    publish: () => ({
      promise: () => Promise.resolve()
    })
  });

  snsPublishSpy = sinon.spy(aws.sns(), 'publish');
});

test.beforeEach((t) => {
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
  const { message } = t.context;
  const cwEventMessage = createCloudwatchEventMessage({
    message,
    status: 'SUCCEEDED'
  });

  await handler(cwEventMessage);

  t.is(snsPublishSpy.called, true);
  t.is(snsPublishSpy.callCount, 3);
  const expectedMessage = {
    ...message,
    meta: {
      status: 'completed'
    }
  };

  t.deepEqual(JSON.parse(snsPublishSpy.args[0][0].Message), expectedMessage);
});

test.serial('lambda publishes running report to all SNS topics', async (t) => {
  const { message } = t.context;
  const cwEventMessage = createCloudwatchEventMessage({
    message,
    status: 'RUNNING'
  });

  await handler(cwEventMessage);

  t.is(snsPublishSpy.called, true);
  t.is(snsPublishSpy.callCount, 3);
  const expectedMessage = {
    ...message,
    meta: {
      status: 'running'
    }
  };

  t.deepEqual(JSON.parse(snsPublishSpy.args[0][0].Message), expectedMessage);
});
