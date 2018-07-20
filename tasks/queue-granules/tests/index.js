'use strict';

const test = require('ava');

const {
  createQueue,
  getExecutionArn,
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
const { CollectionConfigStore } = require('@cumulus/common');

const { queueGranules } = require('../index');

test.beforeEach(async (t) => {
  t.context.internalBucket = `internal-bucket-${randomString().slice(0, 6)}`;
  t.context.stackName = `stack-${randomString().slice(0, 6)}`;
  t.context.stateMachineArn = randomString();
  t.context.templateBucket = randomString();
  t.context.collectionConfigStore =
    new CollectionConfigStore(t.context.internalBucket, t.context.stackName);

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

test.serial('The correct output is returned when granules are queued without a PDR', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    { dataType, granuleId: randomString(), files: [] },
    { dataType, granuleId: randomString(), files: [] }
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);
  t.is(output.running.length, 2);
  t.falsy(output.pdr);
});

test.serial('The correct output is returned when granules are queued with a PDR', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    { dataType, granuleId: randomString(), files: [] },
    { dataType, granuleId: randomString(), files: [] }
  ];
  event.input.pdr = { name: randomString(), path: randomString() };

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);
  t.is(output.running.length, 2);
  t.deepEqual(output.pdr, event.input.pdr);
});

test.serial('The correct output is returned when no granules are queued', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, collectionConfig);

  const { event } = t.context;
  event.input.granules = [];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);
  t.is(output.running.length, 0);
});

test.serial('Granules are added to the queue', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, collectionConfig);

  const { event } = t.context;
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

test.serial('The correct message is enqueued without a PDR', async (t) => {
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
    t.context.collectionConfigStore.put(granule1.dataType, collectionConfig1),
    t.context.collectionConfigStore.put(granule2.dataType, collectionConfig2)
  ]);

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
  const messages = receiveMessageResponse.Messages.map((message) => JSON.parse(message.Body));

  t.is(messages.length, 2);

  const message1 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule1.granuleId);

  t.truthy(message1);
  t.deepEqual(
    message1,
    {
      cumulus_meta: {
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message1.cumulus_meta.execution_name,
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
    }
  );

  const message2 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule2.granuleId);
  t.truthy(message2);
  t.deepEqual(
    message2,
    {
      cumulus_meta: {
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message2.cumulus_meta.execution_name,
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
    }
  );
});

test.serial('The correct message is enqueued with a PDR', async (t) => {
  const event = t.context.event;

  // if the event.cumulus_config has 'state_machine' and 'execution_name', the enqueued message
  // will have 'parentExecutionArn'
  event.cumulus_config = { state_machine: randomString(), execution_name: randomString() };

  const arn = getExecutionArn(
    event.cumulus_config.state_machine, event.cumulus_config.execution_name
  );

  const pdrName = `pdr-name-${randomString()}`;
  const pdrPath = `pdr-path-${randomString()}`;
  event.input.pdr = { name: pdrName, path: pdrPath };

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
    t.context.collectionConfigStore.put(granule1.dataType, collectionConfig1),
    t.context.collectionConfigStore.put(granule2.dataType, collectionConfig2)
  ]);

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
  const messages = receiveMessageResponse.Messages.map((message) => JSON.parse(message.Body));

  t.is(messages.length, 2);

  const message1 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule1.granuleId);

  t.truthy(message1);
  t.deepEqual(
    message1,
    {
      cumulus_meta: {
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message1.cumulus_meta.execution_name,
        state_machine: t.context.stateMachineArn,
        parentExecutionArn: arn
      },
      meta: {
        pdr: event.input.pdr,
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
    }
  );

  const message2 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule2.granuleId);
  t.truthy(message2);
  t.deepEqual(
    message2,
    {
      cumulus_meta: {
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message2.cumulus_meta.execution_name,
        state_machine: t.context.stateMachineArn,
        parentExecutionArn: arn
      },
      meta: {
        pdr: event.input.pdr,
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
    }
  );
});

test.todo('An appropriate error is thrown if the message template could not be fetched');
