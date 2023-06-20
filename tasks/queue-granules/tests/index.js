'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const {
  s3,
  sqs,
} = require('@cumulus/aws-client/services');
const { createQueue } = require('@cumulus/aws-client/SQS');
const { recursivelyDeleteS3Bucket, s3PutObject } = require('@cumulus/aws-client/S3');
const { buildExecutionArn } = require('@cumulus/message/Executions');
const CollectionConfigStore = require('@cumulus/collection-config-store');
const {
  randomNumber,
  randomString,
  validateConfig,
  validateInput,
  validateOutput,
} = require('@cumulus/common/test-utils');
const sinon = require('sinon');
const pMap = require('p-map');
const noop = require('lodash/noop');

const pMapSpy = sinon.spy(pMap);
const fakeProvidersApi = {};
const { getCollectionIdFromGranule, groupAndBatchGranules, updateGranuleBatchCreatedAt } = require('..');
const fakeGranulesApi = {
  updateGranule: noop,
};

const { queueGranules } = proxyquire('..', {
  'p-map': pMapSpy,
  '@cumulus/api-client': {
    providers: fakeProvidersApi,
    granules: fakeGranulesApi,
  },
});

test.beforeEach(async (t) => {
  pMapSpy.resetHistory();

  t.context.internalBucket = `internal-bucket-${randomString().slice(0, 6)}`;
  t.context.stackName = `stack-${randomString().slice(0, 6)}`;
  t.context.workflow = randomString();
  t.context.stateMachineArn = randomString();
  t.context.collectionConfigStore = new CollectionConfigStore(
    t.context.internalBucket,
    t.context.stackName
  );

  await s3().createBucket({ Bucket: t.context.internalBucket });

  t.context.queueUrl = await createQueue(randomString());

  t.context.queueExecutionLimits = {
    [t.context.queueUrl]: randomNumber(),
  };
  t.context.messageTemplate = {
    cumulus_meta: {
      queueUrl: t.context.queueUrl,
      queueExecutionLimits: t.context.queueExecutionLimits,
    },
  };
  const workflowDefinition = {
    name: t.context.workflow,
    arn: t.context.stateMachineArn,
  };
  const messageTemplateKey = `${t.context.stackName}/workflow_template.json`;
  const workflowDefinitionKey = `${t.context.stackName}/workflows/${t.context.workflow}.json`;
  t.context.messageTemplateKey = messageTemplateKey;
  await Promise.all([
    s3PutObject({
      Bucket: t.context.internalBucket,
      Key: messageTemplateKey,
      Body: JSON.stringify(t.context.messageTemplate),
    }),
    s3PutObject({
      Bucket: t.context.internalBucket,
      Key: workflowDefinitionKey,
      Body: JSON.stringify(workflowDefinition),
    }),
  ]);

  t.context.event = {
    config: {
      internalBucket: t.context.internalBucket,
      stackName: t.context.stackName,
      provider: { name: 'provider-name' },
      queueUrl: t.context.queueUrl,
      granuleIngestWorkflow: t.context.workflow,
    },
    input: {
      granules: [],
    },
  };
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.internalBucket),
    sqs().deleteQueue({ QueueUrl: t.context.event.config.queueUrl }).promise(),
  ]);
});

test('groupAndBatchGranules uses default if batchSize is NaN', (t) => {
  const granules = [
    { granuleId: '1', dataType: 'ABC', version: '001' },
    { granuleId: '2', dataType: 'ABC', version: '002' },
    { granuleId: '3', dataType: 'XYZ', version: '001' },
  ];
  const expectedBatchGranules = granules.map((g) => [g]);
  const actualGroupedAndBatchedGranules = groupAndBatchGranules(granules, undefined);
  t.deepEqual(actualGroupedAndBatchedGranules, expectedBatchGranules);
});

test('groupAndBatchGranules batches granules by collection', (t) => {
  const granules = [
    { granuleId: '1', dataType: 'ABC', version: '001' },
    { granuleId: '2', dataType: 'ABC', version: '002' },
    { granuleId: '3', dataType: 'XYZ', version: '001' },
  ];
  const expectedBatchGranules = granules.map((g) => [g]);
  const actualGroupedAndBatchedGranules = groupAndBatchGranules(granules);
  t.deepEqual(actualGroupedAndBatchedGranules, expectedBatchGranules);
});

test('groupAndBatchGranules respects batchSize', (t) => {
  const granules = [
    { granuleId: '1', dataType: 'ABC', version: '001' },
    { granuleId: '2', dataType: 'ABC', version: '001' },
    { granuleId: '3', dataType: 'ABC', version: '001' },
    { granuleId: '4', dataType: 'ABC', version: '002' },
    { granuleId: '5', dataType: 'ABC', version: '002' },
    { granuleId: '6', dataType: 'XYZ', version: '001' },
  ];
  const expectedBatchGranules = [
    [granules[0], granules[1]],
    [granules[2]],
    [granules[3], granules[4]],
    [granules[5]],
  ];
  const actualGroupedAndBatchedGranules = groupAndBatchGranules(granules, 2);
  t.deepEqual(actualGroupedAndBatchedGranules, expectedBatchGranules);
});

test('groupAndBatchGranules further divides batches by provider if granules have one', (t) => {
  const granules = [
    { granuleId: '1', dataType: 'ABC', version: '001' },
    { granuleId: '2', dataType: 'ABC', version: '001', provider: 'prov' },
    { granuleId: '3', dataType: 'ABC', version: '001', provider: 'prov' },
    { granuleId: '4', dataType: 'ABC', version: '002' },
  ];
  const expectedBatchGranules = [
    [granules[0]],
    [granules[1], granules[2]],
    [granules[3]],
  ];
  const actualGroupedAndBatchedGranules = groupAndBatchGranules(granules, 3);
  t.deepEqual(actualGroupedAndBatchedGranules, expectedBatchGranules);
});

test.serial('The correct output is returned when granules are queued without a PDR', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    {
      dataType, version, granuleId: randomString(), files: [],
    },
    {
      dataType, version, granuleId: randomString(), files: [],
    },
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
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    {
      dataType, version, granuleId: randomString(), files: [],
    },
    {
      dataType, version, granuleId: randomString(), files: [],
    },
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
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

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
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    {
      dataType, version, granuleId: randomString(), files: [],
    },
    {
      dataType, version, granuleId: randomString(), files: [],
    },
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();
  const messages = receiveMessageResponse.Messages;

  t.is(messages.length, 2);
});

test.serial('The correct message is enqueued without a PDR', async (t) => {
  const {
    collectionConfigStore,
    event,
    queueUrl,
    queueExecutionLimits,
    stateMachineArn,
    workflow,
  } = t.context;

  const createdAt = Date.now();

  const granule1 = {
    createdAt,
    dataType: `data-type-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }],
    granuleId: `granule-${randomString().slice(0, 6)}`,
    version: '6',
  };
  const collectionConfig1 = { name: `collection-config-${randomString().slice(0, 6)}` };

  const granule2 = {
    createdAt,
    dataType: `data-type-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }],
    granuleId: `granule-${randomString().slice(0, 6)}`,
    version: '6',
  };
  const collectionConfig2 = { name: `collection-config-${randomString().slice(0, 6)}` };

  event.input.granules = [granule1, granule2];

  await Promise.all([
    collectionConfigStore.put(granule1.dataType, granule1.version, collectionConfig1),
    collectionConfigStore.put(granule2.dataType, granule2.version, collectionConfig2),
  ]);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
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
        queueUrl,
        queueExecutionLimits,
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message1.cumulus_meta.execution_name,
        state_machine: stateMachineArn,
      },
      meta: {
        collection: collectionConfig1,
        provider: { name: 'provider-name' },
        workflow_name: workflow,
      },
      payload: {
        granules: [
          {
            createdAt,
            dataType: granule1.dataType,
            files: granule1.files,
            granuleId: granule1.granuleId,
            version: granule1.version,
          },
        ],
      },
    }
  );

  const message2 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule2.granuleId);
  t.truthy(message2);
  t.deepEqual(
    message2,
    {
      cumulus_meta: {
        queueUrl,
        queueExecutionLimits,
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message2.cumulus_meta.execution_name,
        state_machine: stateMachineArn,
      },
      meta: {
        collection: collectionConfig2,
        provider: { name: 'provider-name' },
        workflow_name: workflow,
      },
      payload: {
        granules: [
          {
            createdAt,
            dataType: granule2.dataType,
            files: granule2.files,
            granuleId: granule2.granuleId,
            version: granule2.version,
          },
        ],
      },
    }
  );
});

test.serial('granules are enqueued with createdAt values added to granules that are missing them', async (t) => {
  const {
    collectionConfigStore,
    event,
  } = t.context;

  const createdAt = Date.now();

  const granule1 = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }],
    granuleId: `granule-${randomString().slice(0, 6)}`,
    version: '6',
  };
  const collectionConfig1 = { name: `collection-config-${randomString().slice(0, 6)}` };

  const granule2 = {
    createdAt,
    dataType: `data-type-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }],
    granuleId: `granule-${randomString().slice(0, 6)}`,
    version: '6',
  };
  const collectionConfig2 = { name: `collection-config-${randomString().slice(0, 6)}` };

  event.input.granules = [granule1, granule2];

  await Promise.all([
    collectionConfigStore.put(granule1.dataType, granule1.version, collectionConfig1),
    collectionConfigStore.put(granule2.dataType, granule2.version, collectionConfig2),
  ]);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();
  const messages = receiveMessageResponse.Messages.map((message) => JSON.parse(message.Body));

  t.is(messages.length, 2);

  const message1 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule1.granuleId);
  const message2 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule2.granuleId);

  t.true(createdAt < message1.payload.granules[0].createdAt);
  t.is(createdAt, message2.payload.granules[0].createdAt);
});

test.serial('The correct message is enqueued with a PDR', async (t) => {
  const {
    collectionConfigStore,
    event,
    queueUrl,
    queueExecutionLimits,
    stateMachineArn,
    workflow,
  } = t.context;

  const createdAt = Date.now();

  // if the event.cumulus_config has 'state_machine' and 'execution_name', the enqueued message
  // will have 'parentExecutionArn'
  event.cumulus_config = { state_machine: randomString(), execution_name: randomString() };

  const arn = buildExecutionArn(
    event.cumulus_config.state_machine, event.cumulus_config.execution_name
  );

  const pdrName = `pdr-name-${randomString()}`;
  const pdrPath = `pdr-path-${randomString()}`;
  event.input.pdr = { name: pdrName, path: pdrPath };

  const granule1 = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    version: '6',
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }],
    createdAt,
  };
  const collectionConfig1 = { name: `collection-config-${randomString().slice(0, 6)}` };

  const granule2 = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    version: '6',
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }],
    createdAt,
  };
  const collectionConfig2 = { name: `collection-config-${randomString().slice(0, 6)}` };

  event.input.granules = [granule1, granule2];

  await Promise.all([
    collectionConfigStore.put(granule1.dataType, granule1.version, collectionConfig1),
    collectionConfigStore.put(granule2.dataType, granule2.version, collectionConfig2),
  ]);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
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
        queueUrl,
        queueExecutionLimits,
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message1.cumulus_meta.execution_name,
        parentExecutionArn: arn,
        state_machine: stateMachineArn,
      },
      meta: {
        pdr: event.input.pdr,
        collection: collectionConfig1,
        provider: { name: 'provider-name' },
        workflow_name: workflow,
      },
      payload: {
        granules: [
          {
            dataType: granule1.dataType,
            granuleId: granule1.granuleId,
            files: granule1.files,
            version: granule1.version,
            createdAt,
          },
        ],
      },
    }
  );

  const message2 = messages.find((message) =>
    message.payload.granules[0].granuleId === granule2.granuleId);
  t.truthy(message2);
  t.deepEqual(
    message2,
    {
      cumulus_meta: {
        queueUrl,
        queueExecutionLimits,
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message2.cumulus_meta.execution_name,
        parentExecutionArn: arn,
        state_machine: stateMachineArn,
      },
      meta: {
        pdr: event.input.pdr,
        collection: collectionConfig2,
        provider: { name: 'provider-name' },
        workflow_name: workflow,
      },
      payload: {
        granules: [
          {
            dataType: granule2.dataType,
            granuleId: granule2.granuleId,
            files: granule2.files,
            version: granule2.version,
            createdAt,
          },
        ],
      },
    }
  );
});

test.serial('If a granule has a provider property, that provider is used', async (t) => {
  const dataType = randomString();
  const version = randomString();
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const provider = { id: randomString(), host: randomString() };

  fakeProvidersApi.getProvider = ({ prefix, providerId }) => {
    t.is(prefix, t.context.stackName);
    t.is(providerId, provider.id);

    return Promise.resolve({
      body: JSON.stringify(provider),
    });
  };

  const { event } = t.context;

  event.input.granules = [
    {
      dataType,
      version,
      provider: provider.id,
      granuleId: randomString(),
      files: [],
    },
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();

  t.is(Messages.length, 1);

  const parsedBody = JSON.parse(Messages[0].Body);

  t.deepEqual(parsedBody.meta.provider, provider);
});

test.serial('A default concurrency of 3 is used', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    {
      dataType, version, granuleId: randomString(), files: [],
    },
    {
      dataType, version, granuleId: randomString(), files: [],
    },
  ];

  await queueGranules(event);

  t.true(pMapSpy.calledThrice);
  pMapSpy.getCalls().forEach((call) => t.true(call.calledWithMatch(
    sinon.match.any,
    sinon.match.any,
    sinon.match({ concurrency: 3 })
  )));
});

test.serial('A configured concurrency is used', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const { event } = t.context;

  event.config.concurrency = 99;

  event.input.granules = [
    {
      dataType, version, granuleId: randomString(), files: [],
    },
    {
      dataType, version, granuleId: randomString(), files: [],
    },
  ];

  await queueGranules(event);

  t.true(pMapSpy.calledThrice);
  pMapSpy.getCalls().forEach((call) => t.true(call.calledWithMatch(
    sinon.match.any,
    sinon.match.any,
    sinon.match({ concurrency: 99 })
  )));
});

test.serial('A config with executionNamePrefix is handled as expected', async (t) => {
  const { event } = t.context;

  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const executionNamePrefix = randomString(3);
  event.config.executionNamePrefix = executionNamePrefix;

  event.input.granules = [
    {
      dataType,
      version,
      granuleId: randomString(),
      files: [],
    },
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();

  const messages = receiveMessageResponse.Messages;

  t.is(messages.length, 1);

  const message = JSON.parse(messages[0].Body);

  t.true(
    message.cumulus_meta.execution_name.startsWith(executionNamePrefix),
    `Expected "${message.cumulus_meta.execution_name}" to start with "${executionNamePrefix}"`
  );

  // Make sure that the execution name isn't _just_ the prefix
  t.true(
    message.cumulus_meta.execution_name.length > executionNamePrefix.length
  );
});

test.serial('If a childWorkflowMeta is provided, it is passed through to the message builder and merged into the new message meta', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    {
      dataType, version, granuleId: randomString(), files: [],
    },
  ];

  const cnm = {
    id: 1234,
    body: 'string',
  };
  event.config.childWorkflowMeta = {
    cnm,
  };

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();

  const messages = receiveMessageResponse.Messages;

  t.is(messages.length, 1);

  const message = JSON.parse(messages[0].Body);

  t.deepEqual(
    message.meta.cnm, cnm
  );
});

test.serial('createdAt for queued granule is equal to enqueueGranuleIngestMessage date when granules do not have createdAt set', async (t) => {
  const { event } = t.context;
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);
  event.input.granules = [
    {
      dataType, version, granuleId: randomString(), files: [],
    },
    {
      dataType, version, granuleId: randomString(), files: [],
    },
  ];

  const updateGranuleMock = sinon.spy(({ body }) => body.createdAt);
  const enqueueGranuleIngestMessageMock = sinon.spy((params) => params);

  const testMocks = {
    updateGranuleMock,
    enqueueGranuleIngestMessageMock,
  };

  await queueGranules(event, testMocks);
  const expectedCreatedAt = enqueueGranuleIngestMessageMock.returnValues[0].granules[0].createdAt;
  t.deepEqual(dataType + '___' + version, getCollectionIdFromGranule(event.input.granules[0]));
  t.assert(updateGranuleMock.returnValues[0] === expectedCreatedAt);
});

test('updatedGranuleBatchCreatedAt updates batch granule object with correct createdAt values', (t) => {
  const testGranuleBatch = [
    {
      granuleId: 1,
      collectionId: 'fakeCollection',
      status: 'complete',
    },
    {
      granuleId: 1,
      collectionId: 'fakeCollection',
      status: 'complete',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
  const createdAtTestDate = Date.now();

  const expected = [{ ...testGranuleBatch[0], createdAt: createdAtTestDate }, testGranuleBatch[1]];

  const actual = updateGranuleBatchCreatedAt(testGranuleBatch, createdAtTestDate);
  t.deepEqual(actual, expected);
});

test.serial('queueGranules throws an error when no dataType, version, or collectionId are provided in input', async (t) => {
  const { event } = t.context;
  event.input.granules = [
    {
      granuleId: randomString(), files: [],
    },
    {
      granuleId: randomString(), files: [],
    },
  ];

  await t.throwsAsync(getCollectionIdFromGranule(event.input.granules[0]));
  await t.throwsAsync(queueGranules(event));
});

test.serial('queueGranules does not throw an error when collectionId is provided in the task input', async (t) => {
  const dataType = undefined;
  const version = undefined;
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    {
      collectionId: 'ABC___001', granuleId: randomString(), files: [],
    },
    {
      collectionId: 'ABC___001', granuleId: randomString(), files: [],
    },
  ];
  await t.deepEqual('ABC___001', getCollectionIdFromGranule(event.input.granules[0]));
  await t.notThrowsAsync(queueGranules(event));
});
