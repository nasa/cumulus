'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const MessageTemplateStore = require('../../lib/MessageTemplateStore');

let bucket;
test.before(async () => {
  bucket = randomString();
  await s3().createBucket({ Bucket: bucket }).promise();
});

test.beforeEach(async (t) => {
  t.context.workflowName = randomString();
  t.context.stackName = randomString();

  t.context.messageTemplateStore = new MessageTemplateStore({
    bucket,
    name: t.context.name,
    stackName: t.context.stackName,
    s3: s3()
  });
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(bucket);
});

const requiredParams = ['bucket', 's3', 'stackName'];

requiredParams.forEach((requiredParam) => {
  test(`The MessageTemplateStore constructor requires that ${requiredParam} be set`, async (t) => {
    const { stackName } = t.context;

    const params = {
      bucket,
      s3: s3(),
      stackName
    };
    delete params[requiredParam];

    try {
      new MessageTemplateStore(params);
      t.fail('Expected an error to be thrown');
    }
    catch (err) {
      t.true(err instanceof TypeError);
      t.is(err.message, `${requiredParam} is required`);
    }
  });
});

test('MessageTemplateStore.messageTemplateUrl returns the correct s3:// URL', (t) => {
  const { workflowName, stackName, messageTemplateStore } = t.context;

  t.is(
    messageTemplateStore.templateS3Url(workflowName),
    `s3://${bucket}/${stackName}/workflows/${workflowName}.json`
  );
});

test('MessageTemplateStore.put() writes the template to S3', async (t) => {
  const { workflowName, stackName, messageTemplateStore } = t.context;

  await messageTemplateStore.put(workflowName, 'my-template');

  const { Body } = await s3().getObject({
    Bucket: bucket,
    Key: `${stackName}/workflows/${workflowName}.json`
  }).promise();

  t.is(Body.toString(), 'my-template');
});

test('MessageTemplateStore.exists() returns true if the workflow message template exists in S3', async (t) => {
  const { workflowName, messageTemplateStore } = t.context;

  await messageTemplateStore.put(workflowName, 'my-message-template');

  t.true(await messageTemplateStore.exists(workflowName));
});

test('MessageTemplateStore.exists() returns false if the workflow message template does not exist in S3', async (t) => {
  const { messageTemplateStore } = t.context;

  t.false(await messageTemplateStore.exists('does-not-exist'));
});

test('MessageTemplateStore.get() returns the requested message template', async (t) => {
  const { workflowName, messageTemplateStore } = t.context;

  await messageTemplateStore.put(workflowName, 'my-message-template');

  t.is(await messageTemplateStore.get(workflowName), 'my-message-template');
});
