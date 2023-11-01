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
  randomId,
  validateConfig,
  validateInput,
  validateOutput,
} = require('@cumulus/common/test-utils');

const { queueWorkflow } = require('..');

test.beforeEach(async (t) => {
  t.context.templateBucket = randomId('bucket');
  await s3().createBucket({ Bucket: t.context.templateBucket });

  t.context.workflow = randomId('Workflow');
  t.context.stateMachineArn = randomId('stateMachineArn');

  t.context.stackName = randomId('stackName');

  t.context.queueUrl = await createQueue(randomId('queue'));

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
  t.context.queuedWorkflow = randomId('PublishWorkflow');
  t.context.queuedWorkflowStateMachineArn = randomId('PublishWorkflowArn');
  const queuedWorkflowDefinition = {
    name: t.context.queuedWorkflow,
    arn: t.context.queuedWorkflowStateMachineArn,
  };
  const messageTemplateKey = `${t.context.stackName}/workflow_template.json`;
  const workflowDefinitionKey = `${t.context.stackName}/workflows/${t.context.workflow}.json`;
  const queuedWorkflowDefinitionKey = `${t.context.stackName}/workflows/${t.context.queuedWorkflow}.json`;
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
    s3PutObject({
      Bucket: t.context.templateBucket,
      Key: queuedWorkflowDefinitionKey,
      Body: JSON.stringify(queuedWorkflowDefinition),
    }),
  ]);

  t.context.event = {
    config: {
      workflow: t.context.workflow,
      queueUrl: t.context.queueUrl,
      stackName: t.context.stackName,
      internalBucket: t.context.templateBucket,
    },
    input: {
      prop1: randomId('prop1'),
      prop2: randomId('prop2'),
    },
  };
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.templateBucket),
    sqs().deleteQueue({ QueueUrl: t.context.event.config.queueUrl }).promise(),
  ]);
});

test.serial('The correct output is returned when workflow is queued', async (t) => {
  const event = t.context.event;
  event.config.workflow = t.context.workflow;

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueWorkflow(event);

  await validateOutput(t, output);

  t.deepEqual(output.workflow, event.config.workflow);
});

test.serial('Workflow is added to the queue', async (t) => {
  const event = t.context.event;
  event.config.workflow = t.context.queuedWorkflow;

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueWorkflow(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: t.context.event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();
  const messages = receiveMessageResponse.Messages;

  t.is(messages.length, 1);
});

test.serial('Workflow is added to the input queue', async (t) => {
  const event = t.context.event;
  event.config.workflow = t.context.queuedWorkflow;
  event.input.queueUrl = await createQueue(randomId('inputQueueUrl'));

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueWorkflow(event);

  await validateOutput(t, output);

  // Get messages from the config queue
  const receiveConfigQueueMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();
  const configQueueMessages = receiveConfigQueueMessageResponse.Messages;

  t.is(configQueueMessages, undefined);

  // Get messages from the input queue
  const receiveInputQueueMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.input.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();
  const inputQueueMessages = receiveInputQueueMessageResponse.Messages;

  t.is(inputQueueMessages.length, 1);
});

test.serial('The correct message is enqueued', async (t) => {
  const {
    event,
    queueExecutionLimits,
    queuedWorkflowStateMachineArn,
  } = t.context;

  // if event.cumulus_config has 'state_machine' and 'execution_name', the enqueued message
  // will have 'parentExecutionArn'
  event.cumulus_config = { state_machine: randomId('state_machine'), execution_name: randomId('execution_name') };
  const arn = buildExecutionArn(
    event.cumulus_config.state_machine, event.cumulus_config.execution_name
  );
  event.config.workflow = t.context.queuedWorkflow;
  event.config.workflowInput = { prop1: randomId('prop1'), prop2: randomId('prop2') };
  event.config.childWorkflowMeta = { metakey1: randomId('metavalue1') };

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueWorkflow(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1,
  }).promise();
  const messages = receiveMessageResponse.Messages.map((message) => JSON.parse(message.Body));

  t.is(messages.length, 1);

  const message = messages[0];
  const receivedWorkflow = message.meta.workflow_name;
  t.is(receivedWorkflow, event.config.workflow);

  const expectedMessage = {
    cumulus_meta: {
      state_machine: queuedWorkflowStateMachineArn,
      parentExecutionArn: arn,
      queueExecutionLimits,
    },
    meta: {
      workflow_name: event.config.workflow,
      ...event.config.childWorkflowMeta,
    },
    payload: {
      prop1: event.config.workflowInput.prop1,
      prop2: event.config.workflowInput.prop2,
    },
  };

  // The execution name is randomly generated, so we don't care what the value is here
  expectedMessage.cumulus_meta.execution_name = message.cumulus_meta.execution_name;
  t.deepEqual(message, expectedMessage);
});

test.serial('A config with executionNamePrefix is handled as expected', async (t) => {
  const { event } = t.context;

  const executionNamePrefix = randomId(3);
  event.config.executionNamePrefix = executionNamePrefix;

  event.input.workflow = { name: randomId('name'), arn: randomId('arn') };

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueWorkflow(event);

  await validateOutput(t, output);

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl: event.config.queueUrl,
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
