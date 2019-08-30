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
  status,
  source = sfEventSource
}) => {
  const message = JSON.stringify({
    cumulus_meta: {
      execution_name: randomString()
    }
  });
  const detail = (status === 'SUCCEEDED'
    ? { status, output: message }
    : { status, input: message });
  return { source, detail };
};

test.before(async () => {
  process.env.execution_sns_topic_arn = randomString();
  process.env.granule_sns_topic_arn = randomString();
  process.env.pdr_sns_topic_arn = randomString();

  snsPublishSpy = sinon.spy();

  snsStub = sinon.stub(aws, 'sns').returns({
    publish: () => ({
      promise: snsPublishSpy
    })
  });
});

test.after.always(async () => {
  snsStub.restore();
});

test('lambda publishes reports to all SNS topics', async (t) => {
  const cwEventMessage = createCloudwatchEventMessage({
    status: 'SUCCEEDED'
  });
  await handler(cwEventMessage);
  t.is(snsPublishSpy.called, true);
  t.is(snsPublishSpy.callCount, 3);
});
