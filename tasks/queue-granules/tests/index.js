'use strict';

const test = require('ava');

const {
  createQueue,
  s3,
  sqs,
  recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');
const {
  randomString,
  validateConfig,
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');

const { queueGranules } = require('../index');

test.beforeEach(async (t) => {
  t.context.internalBucket = `internal-bucket-${randomString().slice(0, 6)}`;
  t.context.stackName = `stack-${randomString().slice(0, 6)}`;
  t.context.stateMachineArn = randomString();
  t.context.templateBucket = randomString();

  await Promise.all([
    s3().createBucket({ Bucket: t.context.internalBucket }).promise(),
    s3().createBucket({ Bucket: t.context.templateBucket }).promise()
  ]);

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
      internalBucket: t.context.internalBucket,
      stackName: t.context.stackName,
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
    recursivelyDeleteS3Bucket(t.context.internalBucket),
    recursivelyDeleteS3Bucket(t.context.templateBucket),
    sqs().deleteQueue({ QueueUrl: t.context.event.config.queueUrl }).promise()
  ]);
});

/**
 * Store a collection config in S3
 *
 * @param {Object} testContext - the AVA test context
 * @param {string} dataType - the datatype described by the collection config
 * @param {Object} collectionConfig - a collection config
 * @returns {Promise} resolves when the collection config has been stored
 */
function uploadCollectionConfig(testContext, dataType, collectionConfig) {
  return s3().putObject({
    Bucket: testContext.internalBucket,
    Key: `${testContext.stackName}/collections/${dataType}.json`,
    Body: JSON.stringify(collectionConfig)
  }).promise();
}

test('The correct output is returned when granules are queued', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const collectionConfig = { foo: 'bar' };
  await uploadCollectionConfig(t.context, dataType, collectionConfig);

  const event = t.context.event;
  event.input.granules = [
    { dataType, granuleId: randomString(), files: [] },
    { dataType, granuleId: randomString(), files: [] }
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
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const collectionConfig = { foo: 'bar' };
  await uploadCollectionConfig(t.context, dataType, collectionConfig);

  const event = t.context.event;
  event.input.granules = [
    { dataType, granuleId: randomString(), files: [] },
    { dataType, granuleId: randomString(), files: [] }
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
  const event = t.context.event;

  const granule1 = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }]
  };
  const collectionConfig1 = { name: `collection-config-${randomString().slice(0, 6)}` };

  const granule2 = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }]
  };
  const collectionConfig2 = { name: `collection-config-${randomString().slice(0, 6)}` };

  event.input.granules = [granule1, granule2];

  await Promise.all([
    uploadCollectionConfig(t.context, granule1.dataType, collectionConfig1),
    uploadCollectionConfig(t.context, granule2.dataType, collectionConfig2)
  ]);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  const expectedMessage1 = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: {
      collection: collectionConfig1,
      provider: { name: 'provider-name' }
    },
    payload: {
      granules: [
        {
          granuleId: granule1.granuleId,
          files: granule1.files
        }
      ]
    }
  };

  const expectedMessage2 = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: {
      collection: collectionConfig2,
      provider: { name: 'provider-name' }
    },
    payload: {
      granules: [
        {
          granuleId: granule2.granuleId,
          files: granule2.files
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

  t.is(messages.length, 2);

  const message1 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule1.granuleId);

  t.truthy(message1);
  t.deepEqual(message1, expectedMessage1);

  const message2 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule2.granuleId);
  t.truthy(message2);
  t.deepEqual(message2, expectedMessage2);
});

test('The correct message is enqueued with a PDR', async (t) => {
  const pdrName = `pdr-name-${randomString()}`;
  const pdrPath = `pdr-path-${randomString()}`;

  const event = t.context.event;

  const granule = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }]
  };

  const collectionConfig = { name: `collection-config-${randomString().slice(0, 6)}` };

  event.input.granules = [granule];
  event.input.pdr = { name: pdrName, path: pdrPath };

  await uploadCollectionConfig(t.context, granule.dataType, collectionConfig);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  const expectedMessage = {
    cumulus_meta: {
      state_machine: t.context.stateMachineArn
    },
    meta: {
      collection: collectionConfig,
      provider: { name: 'provider-name' }
    },
    payload: {
      granules: [
        {
          granuleId: granule.granuleId,
          files: granule.files
        }
      ],
      pdr: {
        name: pdrName,
        path: pdrPath
      }
    }
  };

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }).promise();
  const messages = receiveMessageResponse.Messages.map((message) => JSON.parse(message.Body));

  t.is(messages.length, 1);

  t.deepEqual(messages[0], expectedMessage);
});

test.todo('An appropriate error is thrown if the message template could not be fetched');
