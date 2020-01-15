'use strict';

const test = require('ava');

const {
  createQueue,
  getExecutionArn,
  s3,
  s3PutObject,
  sqs,
  recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');
const {
  randomId,
  randomNumber,
  randomString,
  validateConfig,
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');
const { CollectionConfigStore } = require('@cumulus/common');

const { queueGranules } = require('..');

test.beforeEach(async (t) => {
  t.context.internalBucket = `internal-bucket-${randomString().slice(0, 6)}`;
  t.context.stackName = `stack-${randomString().slice(0, 6)}`;
  t.context.workflow = randomString();
  t.context.stateMachineArn = randomString();
  t.context.collectionConfigStore = new CollectionConfigStore(
    t.context.internalBucket,
    t.context.stackName
  );

  await s3().createBucket({ Bucket: t.context.internalBucket }).promise();

  const queueName = randomId('queue');
  t.context.queueName = queueName;
  const queueUrl = await createQueue(randomString());

  t.context.queues = {
    [queueName]: queueUrl
  };
  t.context.queueExecutionLimits = {
    [queueName]: randomNumber()
  };
  t.context.messageTemplate = {
    cumulus_meta: {
      queueName
    },
    meta: {
      queues: t.context.queues,
      queueExecutionLimits: t.context.queueExecutionLimits
    }
  };
  const workflowDefinition = {
    name: t.context.workflow,
    arn: t.context.stateMachineArn
  };
  const messageTemplateKey = `${t.context.stackName}/workflow_template.json`;
  const workflowDefinitionKey = `${t.context.stackName}/workflows/${t.context.workflow}.json`;
  t.context.messageTemplateKey = messageTemplateKey;
  await Promise.all([
    s3PutObject({
      Bucket: t.context.internalBucket,
      Key: messageTemplateKey,
      Body: JSON.stringify(t.context.messageTemplate)
    }),
    s3PutObject({
      Bucket: t.context.internalBucket,
      Key: workflowDefinitionKey,
      Body: JSON.stringify(workflowDefinition)
    })
  ]);

  t.context.event = {
    config: {
      internalBucket: t.context.internalBucket,
      stackName: t.context.stackName,
      provider: { name: 'provider-name' },
      queueUrl,
      granuleIngestWorkflow: t.context.workflow
    },
    input: {
      granules: []
    }
  };
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.internalBucket),
    sqs().deleteQueue({ QueueUrl: t.context.event.config.queueUrl }).promise()
  ]);
});

test.serial('The correct output is returned when granules are queued without a PDR', async (t) => {
  const dataType = `data-type-${randomString().slice(0, 6)}`;
  const version = '6';
  const collectionConfig = { foo: 'bar' };
  await t.context.collectionConfigStore.put(dataType, version, collectionConfig);

  const { event } = t.context;
  event.input.granules = [
    {
      dataType: dataType, version: version, granuleId: randomString(), files: []
    },
    {
      dataType: dataType, version: version, granuleId: randomString(), files: []
    }
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
      dataType: dataType, version: version, granuleId: randomString(), files: []
    },
    {
      dataType: dataType, version: version, granuleId: randomString(), files: []
    }
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
      dataType: dataType, version: version, granuleId: randomString(), files: []
    },
    {
      dataType: dataType, version: version, granuleId: randomString(), files: []
    }
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
  const {
    collectionConfigStore,
    event,
    queueName,
    queues,
    queueExecutionLimits,
    stateMachineArn,
    workflow
  } = t.context;

  const granule1 = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    version: '6',
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }]
  };
  const collectionConfig1 = { name: `collection-config-${randomString().slice(0, 6)}` };

  const granule2 = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    version: '6',
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }]
  };
  const collectionConfig2 = { name: `collection-config-${randomString().slice(0, 6)}` };

  event.input.granules = [granule1, granule2];

  await Promise.all([
    collectionConfigStore.put(granule1.dataType, granule1.version, collectionConfig1),
    collectionConfigStore.put(granule2.dataType, granule2.version, collectionConfig2)
  ]);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
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
        queueName,
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message1.cumulus_meta.execution_name,
        state_machine: stateMachineArn
      },
      meta: {
        queues,
        queueExecutionLimits,
        collection: collectionConfig1,
        provider: { name: 'provider-name' },
        workflow_name: workflow
      },
      payload: {
        granules: [
          {
            dataType: granule1.dataType,
            granuleId: granule1.granuleId,
            files: granule1.files,
            version: granule1.version
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
        queueName,
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message2.cumulus_meta.execution_name,
        state_machine: stateMachineArn
      },
      meta: {
        queues,
        queueExecutionLimits,
        collection: collectionConfig2,
        provider: { name: 'provider-name' },
        workflow_name: workflow
      },
      payload: {
        granules: [
          {
            dataType: granule2.dataType,
            granuleId: granule2.granuleId,
            files: granule2.files,
            version: granule2.version
          }
        ]
      }
    }
  );
});

test.serial('The correct message is enqueued with a PDR', async (t) => {
  const {
    collectionConfigStore,
    event,
    queueName,
    queues,
    queueExecutionLimits,
    stateMachineArn,
    workflow
  } = t.context;

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
    version: '6',
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }]
  };
  const collectionConfig1 = { name: `collection-config-${randomString().slice(0, 6)}` };

  const granule2 = {
    dataType: `data-type-${randomString().slice(0, 6)}`,
    version: '6',
    granuleId: `granule-${randomString().slice(0, 6)}`,
    files: [{ name: `file-${randomString().slice(0, 6)}` }]
  };
  const collectionConfig2 = { name: `collection-config-${randomString().slice(0, 6)}` };

  event.input.granules = [granule1, granule2];

  await Promise.all([
    collectionConfigStore.put(granule1.dataType, granule1.version, collectionConfig1),
    collectionConfigStore.put(granule2.dataType, granule2.version, collectionConfig2)
  ]);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueGranules(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
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
        queueName,
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message1.cumulus_meta.execution_name,
        parentExecutionArn: arn,
        state_machine: stateMachineArn
      },
      meta: {
        queues,
        queueExecutionLimits,
        pdr: event.input.pdr,
        collection: collectionConfig1,
        provider: { name: 'provider-name' },
        workflow_name: workflow
      },
      payload: {
        granules: [
          {
            dataType: granule1.dataType,
            granuleId: granule1.granuleId,
            files: granule1.files,
            version: granule1.version
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
        queueName,
        // The execution name is randomly generated, so we don't care what the value is here
        execution_name: message2.cumulus_meta.execution_name,
        parentExecutionArn: arn,
        state_machine: stateMachineArn
      },
      meta: {
        queues,
        queueExecutionLimits,
        pdr: event.input.pdr,
        collection: collectionConfig2,
        provider: { name: 'provider-name' },
        workflow_name: workflow
      },
      payload: {
        granules: [
          {
            dataType: granule2.dataType,
            granuleId: granule2.granuleId,
            files: granule2.files,
            version: granule2.version
          }
        ]
      }
    }
  );
});
