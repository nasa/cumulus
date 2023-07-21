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
const { constructCollectionId } = require('@cumulus/message/Collections');
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
const { updateGranuleBatchCreatedAt } = require('..');
const fakeProvidersApi = {};
const fetchCollectionStub = sinon.stub();
const fakeGranulesApi = {
  updateGranule: noop,
};

const { queueGranules } = proxyquire('..', {
  'p-map': pMapSpy,
  '@cumulus/api-client': {
    collections: { getCollection: fetchCollectionStub },
    granules: fakeGranulesApi,
    providers: fakeProvidersApi,
  },
});

test.beforeEach(async (t) => {
  pMapSpy.resetHistory();

  t.context.internalBucket = `internal-bucket-${randomString().slice(0, 6)}`;
  t.context.stackName = `stack-${randomString().slice(0, 6)}`;
  t.context.workflow = randomString();
  t.context.stateMachineArn = randomString();
  fetchCollectionStub.resetBehavior();
  t.context.getCollection = fetchCollectionStub;

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

test.serial('The correct output is returned when granules are queued without a PDR', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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
    getCollection,
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
    getCollection.withArgs({
      prefix: t.context.stackName,
      collectionName: granule1.dataType,
      collectionVersion: granule1.version,
    }).returns(collectionConfig1),
    getCollection.withArgs({
      prefix: t.context.stackName,
      collectionName: granule2.dataType,
      collectionVersion: granule2.version,
    }).returns(collectionConfig2),
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
    getCollection,
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
    getCollection.withArgs({
      prefix: t.context.stackName,
      collectionName: granule1.dataType,
      collectionVersion: granule1.version,
    }).returns(collectionConfig1),
    getCollection.withArgs({
      prefix: t.context.stackName,
      collectionName: granule2.dataType,
      collectionVersion: granule2.version,
    }).returns(collectionConfig2),
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
    getCollection,
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
    getCollection.withArgs({
      prefix: t.context.stackName,
      collectionName: granule1.dataType,
      collectionVersion: granule1.version,
    }).returns(collectionConfig1),
    getCollection.withArgs({
      prefix: t.context.stackName,
      collectionName: granule2.dataType,
      collectionVersion: granule2.version,
    }).returns(collectionConfig2),
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
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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

  t.is(pMapSpy.getCalls().length, 4);
  pMapSpy.getCalls().slice(1).forEach((call) => t.true(call.calledWithMatch(
    sinon.match.any,
    sinon.match.any,
    sinon.match({ concurrency: 3 })
  )));
});

test.serial('A configured concurrency is used', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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

  t.is(pMapSpy.getCalls().length, 4);
  pMapSpy.getCalls().slice(1).forEach((call) => t.true(call.calledWithMatch(
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
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

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
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);
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
  t.is(updateGranuleMock.returnValues[0], expectedCreatedAt);
});

test.serial('updatedGranuleBatchCreatedAt updates batch granule object with correct createdAt values', (t) => {
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

test.serial('hitting defaults for branch coverage', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.getCollection.withArgs({
    prefix: t.context.stackName,
    collectionName: dataType,
    collectionVersion: version,
  }).returns(collectionConfig);

  const { event } = t.context;

  event.config.concurrency = 99;

  event.input.granules = undefined;

  await queueGranules(event);

  t.is(pMapSpy.getCalls().length, 1);
});

test.serial('does not change collection id on granule', async (t) => {
  const { event } = t.context;

  event.input.granules = [
    {
      granuleId: 'granule-1',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '001',
      files: [],
    },
    {
      granuleId: 'granule-2',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '001',
      files: [],
    },
    {
      granuleId: 'granule-3',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '001',
      files: [],
    },
  ];
  const enqueueGranuleIngestMessageMock = sinon.spy((params) => params);

  const testMocks = {
    updateGranuleMock: sinon.spy(async () => { }),
    enqueueGranuleIngestMessageMock,
  };

  await queueGranules(event, testMocks);

  const createdMap = Object.fromEntries(
    testMocks.updateGranuleMock.getCalls()
      .map(({ args: [params] }) => [params.granuleId, params.body.createdAt])
  );
  t.deepEqual(
    testMocks.updateGranuleMock.getCalls()
      .map(({ args: [params] }) => params)
      .sort(({ granuleId: a }, { granuleId: b }) => a.localeCompare(b)),
    event.input.granules.map(
      ({ granuleId, dataType, version }) => {
        const collectionId = constructCollectionId(dataType, version);
        return {
          prefix: event.config.stackName,
          collectionId,
          granuleId,
          body: {
            collectionId,
            granuleId,
            status: 'queued',
            createdAt: createdMap[granuleId],
          },
        };
      }
    )
  );

  t.deepEqual(
    enqueueGranuleIngestMessageMock.getCalls().length,
    event.input.granules.length
  );
});

test.serial('handles different collections', async (t) => {
  const { event } = t.context;

  event.input.granules = [
    {
      granuleId: 'granule-1',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '001',
      files: [],
    },
    {
      granuleId: 'granule-2',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '001',
      files: [],
    },
    {
      granuleId: 'granule-3',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '002',
      files: [],
    },
  ];
  const enqueueGranuleIngestMessageMock = sinon.spy((params) => params);

  const testMocks = {
    updateGranuleMock: sinon.spy(async () => { }),
    enqueueGranuleIngestMessageMock,
  };

  await queueGranules(event, testMocks);

  const createdMap = Object.fromEntries(
    testMocks.updateGranuleMock.getCalls()
      .map(({ args: [params] }) => [params.granuleId, params.body.createdAt])
  );
  t.deepEqual(
    testMocks.updateGranuleMock.getCalls()
      .map(({ args: [params] }) => params)
      .sort(({ granuleId: a }, { granuleId: b }) => a.localeCompare(b)),
    event.input.granules.map(
      ({ granuleId, dataType, version }) => {
        const collectionId = constructCollectionId(dataType, version);
        return {
          prefix: event.config.stackName,
          collectionId,
          granuleId,
          body: {
            collectionId,
            granuleId,
            status: 'queued',
            createdAt: createdMap[granuleId],
          },
        };
      }
    )
  );

  t.deepEqual(
    enqueueGranuleIngestMessageMock.getCalls().length,
    event.input.granules.length
  );
});

test.serial('handles different providers', async (t) => {
  const { event } = t.context;

  event.input.granules = [
    {
      granuleId: 'granule-1',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '001',
      provider: 'test-s3provider',
      files: [],
    },
    {
      granuleId: 'granule-2',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '001',
      files: [],
    },
    {
      granuleId: 'granule-3',
      dataType: 'http_testcollection_test-stackName-DiscoverGranules-1686092642035',
      version: '002',
      files: [],
    },
  ];
  const enqueueGranuleIngestMessageMock = sinon.spy((params) => params);

  const testMocks = {
    updateGranuleMock: sinon.spy(async () => { }),
    enqueueGranuleIngestMessageMock,
  };

  await queueGranules(event, testMocks);

  const createdMap = Object.fromEntries(
    testMocks.updateGranuleMock.getCalls()
      .map(({ args: [params] }) => [params.granuleId, params.body.createdAt])
  );
  t.deepEqual(
    testMocks.updateGranuleMock.getCalls()
      .map(({ args: [params] }) => params)
      .sort(({ granuleId: a }, { granuleId: b }) => a.localeCompare(b)),
    event.input.granules.map(
      ({ granuleId, dataType, version }) => {
        const collectionId = constructCollectionId(dataType, version);
        return {
          prefix: event.config.stackName,
          collectionId,
          granuleId,
          body: {
            collectionId,
            granuleId,
            status: 'queued',
            createdAt: createdMap[granuleId],
          },
        };
      }
    )
  );

  t.deepEqual(
    enqueueGranuleIngestMessageMock.getCalls().length,
    event.input.granules.length
  );
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

  await t.throwsAsync(queueGranules(event));
});

test.serial('queueGranules does not throw an error when updatedAt is provided and is not provided', async (t) => {
  const { event } = t.context;
  event.input.granules = [
    {
      granuleId: randomString(), files: [], updatedAt: 1553053438767, collectionId: 'ABC___001',
    },
    {
      granuleId: randomString(), files: [], collectionId: 'ABC___001',
    },
  ];

  await t.notThrowsAsync(queueGranules(event));
});

test.serial('queueGranules throws an error when the updatedAt field is not an Integer value', async (t) => {
  const { event } = t.context;
  event.input.granules = [
    {
      granuleId: randomString(), files: [], updatedAt: '12/25/2022', collectionId: 'ABC___001',
    },
    {
      granuleId: randomString(), files: [], updatedAt: 1553053438767.378196, collectionId: 'ABC___001',
    },
  ];

  await t.throwsAsync(queueGranules(event));
});
