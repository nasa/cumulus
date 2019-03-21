'use strict';

const test = require('ava');
const sinon = require('sinon');
const aws = require('@cumulus/common/aws');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const queue = require('../queue');

test.beforeEach(async (t) => {
  t.context.templateBucket = randomString();
  await aws.s3().createBucket({ Bucket: t.context.templateBucket }).promise();

  t.context.queueUrl = await aws.createQueue();

  t.context.stateMachineArn = randomString();

  t.context.messageTemplate = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: { queues: { startSF: t.context.queueUrl } }
  };

  const messageTemplateKey = `${randomString()}/template.json`;
  t.context.messageTemplateKey = messageTemplateKey;
  await aws.s3().putObject({
    Bucket: t.context.templateBucket,
    Key: messageTemplateKey,
    Body: JSON.stringify(t.context.messageTemplate)
  }).promise();

  t.context.template = `s3://${t.context.templateBucket}/${messageTemplateKey}`;
});

test.afterEach(async (t) => {
  await Promise.all([
    aws.recursivelyDeleteS3Bucket(t.context.templateBucket),
    aws.sqs().deleteQueue({ QueueUrl: t.context.queueUrl }).promise()
  ]);
});

test.serial(
  'the queue receives a correctly formatted workflow message without a PDR', async (t) => {
    const granule = { granuleId: '1', files: [] };
    const { queueUrl } = t.context;
    const templateUri = `s3://${t.context.templateBucket}/${t.context.messageTemplateKey}`;
    const collection = { name: 'test-collection', version: '0.0.0' };
    const provider = { id: 'test-provider' };

    const output = await queue
      .enqueueGranuleIngestMessage(granule, queueUrl, templateUri, provider, collection);
    await aws.sqs().receiveMessage({
      QueueUrl: t.context.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1
    }).promise()
      .then((receiveMessageResponse) => {
        t.is(receiveMessageResponse.Messages.length, 1);

        const actualMessage = JSON.parse(receiveMessageResponse.Messages[0].Body);
        const expectedMessage = {
          cumulus_meta: {
            state_machine: t.context.stateMachineArn
          },
          meta: {
            queues: { startSF: t.context.queueUrl },
            provider: provider,
            collection: collection
          },
          payload: { granules: [granule] }
        };
        t.truthy(actualMessage.cumulus_meta.execution_name);
        t.true(output.endsWith(actualMessage.cumulus_meta.execution_name));
        expectedMessage.cumulus_meta.execution_name = actualMessage.cumulus_meta.execution_name;
        t.deepEqual(expectedMessage, actualMessage);
      });
  }
);

test.serial('the queue receives a correctly formatted workflow message with a PDR', async (t) => {
  const granule = { granuleId: '1', files: [] };
  const { queueUrl } = t.context;
  const templateUri = `s3://${t.context.templateBucket}/${t.context.messageTemplateKey}`;
  const collection = { name: 'test-collection', version: '0.0.0' };
  const provider = { id: 'test-provider' };
  const pdr = { name: randomString(), path: randomString() };
  const arn = randomString();

  const output = await queue
    .enqueueGranuleIngestMessage(granule, queueUrl, templateUri, provider, collection, pdr, arn);
  await aws.sqs().receiveMessage({
    QueueUrl: t.context.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }).promise()
    .then((receiveMessageResponse) => {
      t.is(receiveMessageResponse.Messages.length, 1);

      const actualMessage = JSON.parse(receiveMessageResponse.Messages[0].Body);
      const expectedMessage = {
        cumulus_meta: {
          state_machine: t.context.stateMachineArn,
          parentExecutionArn: arn
        },
        meta: {
          queues: { startSF: t.context.queueUrl },
          provider: provider,
          collection: collection,
          pdr: pdr
        },
        payload: { granules: [granule] }
      };
      t.truthy(actualMessage.cumulus_meta.execution_name);
      t.true(output.endsWith(actualMessage.cumulus_meta.execution_name));
      expectedMessage.cumulus_meta.execution_name = actualMessage.cumulus_meta.execution_name;
      t.deepEqual(expectedMessage, actualMessage);
    });
});

test.serial('enqueueGranuleIngestMessage does not transform granule objects ', async (t) => {
  const sendSQSMessageStub = sinon.stub(aws, 'sendSQSMessage').resolves();

  const granule = {
    granuleId: randomId(),
    dataType: randomString(),
    version: randomString(),
    files: [],
    foo: "bar" // should not be removed or altered
  }
  const { queueUrl } = t.context;
  const templateUri = `s3://${t.context.templateBucket}/${t.context.messageTemplateKey}`;
  const collection = { name: 'test-collection', version: '0.0.0' };
  const provider = { id: 'test-provider' };

  const expectedPayload = {
    granules: [granule]
  };

  try {
    await queue.enqueueGranuleIngestMessage(
      granule, queueUrl, templateUri, provider, collection
    );
  }
  catch (err) {
    t.fail(err);
  }
  finally {
    t.true(sendSQSMessageStub.calledOnce);
    t.deepEqual(sendSQSMessageStub.getCall(0).args[1].payload, expectedPayload);
    sendSQSMessageStub.restore();
  }
});