'use strict';

const test = require('ava');

const { createQueue, s3, sqs, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const {
  randomString,
  validateConfig,
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');

const { queuePdrs } = require('../index');

test.beforeEach(async (t) => {
  t.context.templateBucket = randomString();
  await s3().createBucket({ Bucket: t.context.templateBucket }).promise();

  t.context.stateMachineArn = randomString();

  t.context.messageTemplate = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: {}
  };
  const messageTemplateKey = `${randomString()}/template.json`;
  await s3().putObject({
    Bucket: t.context.templateBucket,
    Key: messageTemplateKey,
    Body: JSON.stringify(t.context.messageTemplate)
  }).promise();

  t.context.event = {
    config: {
      collection: { name: 'collection-name' },
      provider: { name: 'provider-name' },
      queueUrl: await createQueue(),
      parsePdrMessageTemplateUri: `s3://${t.context.templateBucket}/${messageTemplateKey}`
    },
    input: {
      pdrs: []
    }
  };
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.templateBucket),
    sqs().deleteQueue({ QueueUrl: t.context.event.config.queueUrl }).promise()
  ]);
});

test('The correct output is returned when PDRs are queued', async (t) => {
  const event = t.context.event;
  event.input.pdrs = [
    { name: randomString(), path: randomString() },
    { name: randomString(), path: randomString() }
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);
  t.deepEqual(output, { pdrs_queued: 2 });
});

test('The correct output is returned when no PDRs are queued', async (t) => {
  const event = t.context.event;
  event.input.pdrs = [];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);
  t.deepEqual(output, { pdrs_queued: 0 });
});

test('PDRs are added to the queue', async (t) => {
  const event = t.context.event;
  event.input.pdrs = [
    { name: randomString(), path: randomString() },
    { name: randomString(), path: randomString() }
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }).promise();
  const messages = receiveMessageResponse.Messages;

  t.is(messages.length, 2);
});

test('The correct message is enqueued', async (t) => {
  const event = t.context.event;
  event.input.pdrs = [
    {
      name: randomString(),
      path: randomString()
    },
    {
      name: randomString(),
      path: randomString()
    },
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }).promise();
  const messages = receiveMessageResponse.Messages.map((message) => JSON.parse(message.Body));

  t.is(messages.length, 2);

  const receivedPdrnames = messages.map((message) => message.payload.pdr.name);
  event.input.pdrs.map((pdr) => pdr.name).forEach((pdrName) =>
    t.true(receivedPdrnames.includes(pdrName)));

  // Figure out what messages we should have received for each PDR
  const expectedMessages = {};
  event.input.pdrs.forEach((pdr) => {
    expectedMessages[pdr.name] = {
      cumulus_meta: {
        state_machine: t.context.stateMachineArn
      },
      meta: {
        collection: { name: 'collection-name' },
        provider: { name: 'provider-name' }
      },
      payload: {
        pdr: {
          name: pdr.name,
          path: pdr.path
        }
      }
    };
  });

  // Make sure we did receive those messages
  messages.forEach((message) => {
    const pdrName = message.payload.pdr.name;
    t.deepEqual(message, expectedMessages[pdrName]);
  });
});

test.todo('An appropriate error is thrown if the message template could not be fetched');
