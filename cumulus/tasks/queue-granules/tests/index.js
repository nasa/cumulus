'use strict';

const test = require('ava');

const { createQueue, s3, sqs, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const {
  randomString,
  validateConfig,
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');

const { queueGranules } = require('../index');

test.beforeEach(async (t) => {
  t.context.stateMachineArn = randomString();

  t.context.templateBucket = randomString();
  await s3().createBucket({ Bucket: t.context.templateBucket }).promise();

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
      granuleIngestMessageTemplateUri: `s3://${t.context.templateBucket}/${messageTemplateKey}`
    },
    input: {
      granules: []
    }
  };
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.templateBucket),
    sqs().deleteQueue({ QueueUrl: t.context.event.config.queueUrl }).promise()
  ]);
});

test('The correct output is returned when granules are queued', async (t) => {
  const event = t.context.event;
  event.input.granules = [
    { granuleId: randomString(), files: [] },
    { granuleId: randomString(), files: [] }
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);
  t.deepEqual(output, { granules_queued: 2 });
});

test('The correct output is returned when no granules are queued', async (t) => {
  const event = t.context.event;
  event.input.granules = [];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);
  t.deepEqual(output, { granules_queued: 0 });
});

test('Granules are added to the queue', async (t) => {
  const event = t.context.event;
  event.input.granules = [
    { granuleId: randomString(), files: [] },
    { granuleId: randomString(), files: [] }
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

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

test('The correct message is enqueued without a PDR', async (t) => {
  const fileNameA = randomString();
  const granuleIdA = randomString();
  const fileNameB = randomString();
  const granuleIdB = randomString();

  const event = t.context.event;
  event.input.granules = [
    {
      granuleId: granuleIdA,
      files: [{ name: fileNameA }]
    },
    {
      granuleId: granuleIdB,
      files: [{ name: fileNameB }]
    }
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  const expectedMessages = {};
  expectedMessages[granuleIdA] = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: {
      collection: { name: 'collection-name' },
      provider: { name: 'provider-name' }
    },
    payload: {
      granules: [
        {
          granuleId: granuleIdA,
          files: [{ name: fileNameA }]
        }
      ]
    }
  };
  expectedMessages[granuleIdB] = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: {
      collection: { name: 'collection-name' },
      provider: { name: 'provider-name' }
    },
    payload: {
      granules: [
        {
          granuleId: granuleIdB,
          files: [{ name: fileNameB }]
        }
      ]
    }
  };

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }).promise();
  const messages = receiveMessageResponse.Messages.map((message) => JSON.parse(message.Body));

  const receivedGranuleIds = messages.map((message) => message.payload.granules[0].granuleId);
  t.true(receivedGranuleIds.includes(granuleIdA));
  t.true(receivedGranuleIds.includes(granuleIdB));

  t.is(messages.length, 2);
  messages.forEach((message) => {
    const granuleId = message.payload.granules[0].granuleId;
    t.deepEqual(message, expectedMessages[granuleId]);
  });
});

test('The correct message is enqueued with a PDR', async (t) => {
  const fileName = randomString();
  const granuleId = randomString();
  const pdrName = randomString();
  const pdrPath = randomString();

  const event = t.context.event;
  event.input.granules = [
    {
      granuleId,
      files: [{ name: fileName }]
    }
  ];
  event.input.pdr = { name: pdrName, path: pdrPath };

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }).promise();
  const messages = receiveMessageResponse.Messages;

  const expectedMessage = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: {
      collection: { name: 'collection-name' },
      provider: { name: 'provider-name' }
    },
    payload: {
      granules: [
        {
          granuleId,
          files: [{ name: fileName }]
        }
      ],
      pdr: {
        name: pdrName,
        path: pdrPath
      }
    }
  };

  t.deepEqual(JSON.parse(messages[0].Body), expectedMessage);
});

test.todo('An appropriate error is thrown if the message template could not be fetched');
