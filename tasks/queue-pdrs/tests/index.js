'use strict';

const test = require('ava');

const {
  s3,
  sqs,
} = require('@cumulus/aws-client/services');
const { createQueue } = require('@cumulus/aws-client/SQS');
const { recursivelyDeleteS3Bucket, s3PutObject } = require('@cumulus/aws-client/S3');
const { buildExecutionArn } = require('@cumulus/message/Executions');
const {
  randomNumber,
  randomString,
  validateConfig,
  validateInput,
  validateOutput,
} = require('@cumulus/common/test-utils');

const { queuePdrs } = require('..');

test.beforeEach(async (t) => {
  t.context.templateBucket = randomString();
  await s3().createBucket({ Bucket: t.context.templateBucket });

  t.context.workflow = randomString();
  t.context.stateMachineArn = randomString();

  t.context.stackName = randomString();

  t.context.queueUrl = await createQueue(randomString());

  t.context.queueExecutionLimits = {
    [t.context.queueUrl]: randomNumber(),
  };
  t.context.messageTemplate = {
    cumulus_meta: {
      queueExecutionLimits: t.context.queueExecutionLimits,
      state_machine: t.context.stateMachineArn,
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
      Bucket: t.context.templateBucket,
      Key: messageTemplateKey,
      Body: JSON.stringify(t.context.messageTemplate),
    }),
    s3PutObject({
      Bucket: t.context.templateBucket,
      Key: workflowDefinitionKey,
      Body: JSON.stringify(workflowDefinition),
    }),
  ]);

  t.context.event = {
    config: {
      collection: { name: 'collection-name' },
      provider: { name: 'provider-name' },
      queueUrl: t.context.queueUrl,
      parsePdrWorkflow: t.context.workflow,
      stackName: t.context.stackName,
      internalBucket: t.context.templateBucket,
    },
    input: {
      pdrs: [],
    },
  };
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.templateBucket),
    sqs().deleteQueue({ QueueUrl: t.context.event.config.queueUrl }),
  ]);
});

test.serial('The correct output is returned when PDRs are queued', async (t) => {
  const event = t.context.event;
  event.input.pdrs = [
    { name: randomString(), path: randomString() },
    { name: randomString(), path: randomString() },
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);
  t.is(output.pdrs_queued, 2);
  t.is(output.running.length, 2);
});

test.serial('The correct output is returned when no PDRs are queued', async (t) => {
  const event = t.context.event;
  event.input.pdrs = [];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);
  t.is(output.pdrs_queued, 0);
  t.is(output.running.length, 0);
});

test.serial('PDRs are added to the queue', async (t) => {
  const event = t.context.event;
  event.input.pdrs = [
    { name: randomString(), path: randomString() },
    { name: randomString(), path: randomString() },
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  });
  const messages = receiveMessageResponse.Messages;

  t.is(messages.length, 2);
});

test.serial('The correct message is enqueued', async (t) => {
  const {
    event,
    queueExecutionLimits,
    stateMachineArn,
    workflow,
  } = t.context;

  // if event.cumulus_config has 'state_machine' and 'execution_name', the enqueued message
  // will have 'parentExecutionArn'
  event.cumulus_config = { state_machine: randomString(), execution_name: randomString() };
  const arn = buildExecutionArn(
    event.cumulus_config.state_machine, event.cumulus_config.execution_name
  );
  event.input.pdrs = [
    {
      name: randomString(),
      path: randomString(),
    },
    {
      name: randomString(),
      path: randomString(),
    },
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  });
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
        state_machine: stateMachineArn,
        parentExecutionArn: arn,
        queueExecutionLimits,
      },
      meta: {
        collection: { name: 'collection-name' },
        provider: { name: 'provider-name' },
        workflow_name: workflow,
      },
      payload: {
        pdr: {
          name: pdr.name,
          path: pdr.path,
        },
      },
    };
  });

  // Make sure we did receive those messages
  messages.forEach((message) => {
    const pdrName = message.payload.pdr.name;
    // The execution name is randomly generated, so we don't care what the value is here
    expectedMessages[pdrName].cumulus_meta.execution_name = message.cumulus_meta.execution_name;
    t.deepEqual(message, expectedMessages[pdrName]);
  });
});

test.serial('A config with executionNamePrefix is handled as expected', async (t) => {
  const { event } = t.context;

  const executionNamePrefix = randomString(3);
  event.config.executionNamePrefix = executionNamePrefix;

  event.input.pdrs = [
    {
      name: randomString(),
      path: randomString(),
    },
  ];

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queuePdrs(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  });

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
  const event = t.context.event;
  event.input.pdrs = [
    { name: randomString(), path: randomString() },
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

  const output = await queuePdrs(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  });

  const messages = receiveMessageResponse.Messages;

  t.is(messages.length, 1);

  const message = JSON.parse(messages[0].Body);

  t.deepEqual(
    message.meta.cnm, cnm
  );
});
