'use strict';

const test = require('ava');

const {
  s3,
  sqs,
} = require('@cumulus/aws-client/services');
const { createQueue } = require('@cumulus/aws-client/SQS');
const { recursivelyDeleteS3Bucket, s3PutObject } = require('@cumulus/aws-client/S3');
// const { buildExecutionArn } = require('@cumulus/message/Executions');
const {
  randomNumber,
  randomString,
  validateConfig,
  validateInput,
  validateOutput,
} = require('@cumulus/common/test-utils');

const { queueWorkflow } = require('..');

test.beforeEach(async (t) => {
  t.context.templateBucket = randomString();
  await s3().createBucket({ Bucket: t.context.templateBucket }).promise();

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
      queueUrl: t.context.queueUrl,
      stackName: t.context.stackName,
      internalBucket: t.context.templateBucket,
    },
    input: {
      workflow: {},
      workflowInput: {
        prop1: randomString(),
        prop2: randomString(),
      },
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
  event.input.workflow = { name: randomString(), arn: randomString() };

  await validateConfig(t, event.config);
  await validateInput(t, event.input);

  const output = await queueWorkflow(event);

  await validateOutput(t, output);

  t.deepEqual(output.workflow, event.input.workflow);
});

// test.serial('The correct output is returned when no workflow is queued', async (t) => {
//   const event = t.context.event;
//   event.workflow = {};
//   event.workflowInput = {};

//   await validateConfig(t, event.config);
//   await validateInput(t, event.input);

//   const output = await queueWorkflow(event);

//   await validateOutput(t, output);
//   t.deepEqual(output.workflow, event.input.workflow);
// });

// test.serial('Workflow is added to the queue', async (t) => {
//   const event = t.context.event;
//   event.input.workflow = { name: randomString(), arn: randomString() };

//   await validateConfig(t, event.config);
//   await validateInput(t, event.input);

//   const output = await queueWorkflow(event);

//   await validateOutput(t, output);

//   // Get messages from the queue
//   const receiveMessageResponse = await sqs().receiveMessage({
//     QueueUrl: t.context.event.config.queueUrl,
//     MaxNumberOfMessages: 10,
//     WaitTimeSeconds: 1,
//   }).promise();
//   const messages = receiveMessageResponse.Messages;

//   t.is(messages.length, 1);
// });

// test.serial('Workflow is added to the input queue', async (t) => {
//   const event = t.context.event;
//   event.input.workflow = { name: randomString(), arn: randomString() };
//   event.input.queueUrl = await createQueue(randomString());

//   await validateConfig(t, event.config);
//   await validateInput(t, event.input);

//   const output = await queueWorkflow(event);

//   await validateOutput(t, output);

//   // Get messages from the config queue
//   const receiveConfigQueueMessageResponse = await sqs().receiveMessage({
//     QueueUrl: event.config.queueUrl,
//     MaxNumberOfMessages: 10,
//     WaitTimeSeconds: 1,
//   }).promise();
//   const configQueueMessages = receiveConfigQueueMessageResponse.Messages;

//   t.is(configQueueMessages, undefined);

//   // Get messages from the input queue
//   const receiveInputQueueMessageResponse = await sqs().receiveMessage({
//     QueueUrl: event.input.queueUrl,
//     MaxNumberOfMessages: 10,
//     WaitTimeSeconds: 1,
//   }).promise();
//   const inputQueueMessages = receiveInputQueueMessageResponse.Messages;

//   t.is(inputQueueMessages.length, 1);
// });

// test.serial('The correct message is enqueued', async (t) => {
//   const {
//     workflow,
//     event,
//     queueExecutionLimits,
//     stateMachineArn,
//   } = t.context;

//   // if event.cumulus_config has 'state_machine' and 'execution_name', the enqueued message
//   // will have 'parentExecutionArn'
//   event.cumulus_config = { state_machine: randomString(), execution_name: randomString() };
//   const arn = buildExecutionArn(
//     event.cumulus_config.state_machine, event.cumulus_config.execution_name
//   );
//   event.input.workflow = { name: randomString(), arn: randomString() };
//   event.input.workflowInput = { prop1: randomString(), prop2: randomString() };

//   await validateConfig(t, event.config);
//   await validateInput(t, event.input);

//   const output = await queueWorkflow(event);

//   await validateOutput(t, output);

//   // Get messages from the queue
//   const receiveMessageResponse = await sqs().receiveMessage({
//     QueueUrl: event.config.queueUrl,
//     MaxNumberOfMessages: 10,
//     WaitTimeSeconds: 1,
//   }).promise();
//   const messages = receiveMessageResponse.Messages.map((message) => JSON.parse(message.Body));

//   t.is(messages.length, 1);

//   const message = messages[0];
//   const receivedWorkflow = message.payload.workflow.name;
//   t.true(receivedWorkflow.includes(event.input.workflow.name));

//   const expectedMessage = {
//     cumulus_meta: {
//       state_machine: stateMachineArn,
//       parentExecutionArn: arn,
//       queueExecutionLimits,
//     },
//     meta: {
//       workflow_name: workflow,
//     },
//     payload: {
//       workflow: {
//         name: event.input.workflow.name,
//         arn: event.input.workflow.arn,
//       },
//       workflowInput: {
//         prop1: event.input.workflowInput.prop1,
//         prop2: event.input.workflowInput.prop2,
//       },
//     },
//   };

//   // The execution name is randomly generated, so we don't care what the value is here
//   expectedMessage.cumulus_meta.execution_name = message.cumulus_meta.execution_name;
//   t.deepEqual(message, expectedMessage);
// });

// test.serial('A config with executionNamePrefix is handled as expected', async (t) => {
//   const { event } = t.context;

//   const executionNamePrefix = randomString(3);
//   event.config.executionNamePrefix = executionNamePrefix;

//   event.input.workflow = { name: randomString(), arn: randomString() };

//   await validateConfig(t, event.config);
//   await validateInput(t, event.input);

//   const output = await queueWorkflow(event);

//   await validateOutput(t, output);

//   // Get messages from the queue
//   const receiveMessageResponse = await sqs().receiveMessage({
//     QueueUrl: event.config.queueUrl,
//     MaxNumberOfMessages: 10,
//     WaitTimeSeconds: 1,
//   }).promise();

//   const messages = receiveMessageResponse.Messages;

//   t.is(messages.length, 1);

//   const message = JSON.parse(messages[0].Body);

//   t.true(
//     message.cumulus_meta.execution_name.startsWith(executionNamePrefix),
//     `Expected "${message.cumulus_meta.execution_name}" to start with "${executionNamePrefix}"`
//   );

//   // Make sure that the execution name isn't _just_ the prefix
//   t.true(
//     message.cumulus_meta.execution_name.length > executionNamePrefix.length
//   );
// });
