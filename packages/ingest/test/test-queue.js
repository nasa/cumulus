'use strict';

const test = require('ava');
const {
  createQueue, sqs, s3, s3PutObject, recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');
const { randomString, randomId, randomNumber } = require('@cumulus/common/test-utils');
const queue = require('../queue');

test.beforeEach(async (t) => {
  t.context.templateBucket = randomString();
  await s3().createBucket({ Bucket: t.context.templateBucket }).promise();

  t.context.stackName = randomId('stack');
  t.context.queueName = randomId('queue');
  t.context.queueUrl = await createQueue();
  t.context.queueExecutionLimit = randomNumber();

  t.context.workflow = randomString();
  t.context.stateMachineArn = randomString();

  t.context.messageTemplate = {
    meta: {
      queues: {
        [t.context.queueName]: t.context.queueUrl
      },
      queueExecutionLimits: {
        [t.context.queueName]: t.context.queueExecutionLimit
      }
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
      Bucket: t.context.templateBucket,
      Key: messageTemplateKey,
      Body: JSON.stringify(t.context.messageTemplate)
    }),
    s3PutObject({
      Bucket: t.context.templateBucket,
      Key: workflowDefinitionKey,
      Body: JSON.stringify(workflowDefinition)
    })
  ]);


  t.context.template = `s3://${t.context.templateBucket}/${messageTemplateKey}`;
});

test.afterEach(async (t) => {
  await Promise.all([
    recursivelyDeleteS3Bucket(t.context.templateBucket),
    sqs().deleteQueue({ QueueUrl: t.context.queueUrl }).promise()
  ]);
});

test.serial('the queue receives a correctly formatted workflow message without a PDR', async (t) => {
  const granule = { granuleId: '1', files: [] };
  const {
    queueExecutionLimit,
    queueName,
    queueUrl,
    stateMachineArn,
    workflow,
    templateBucket,
    stackName
  } = t.context;
  const collection = { name: 'test-collection', version: '0.0.0' };
  const provider = { id: 'test-provider' };

  let output;
  let receiveMessageResponse;

  try {
    output = await queue.enqueueGranuleIngestMessage({
      granule,
      queueUrl,
      granuleIngestWorkflow: workflow,
      provider,
      collection,
      systemBucket: templateBucket,
      stack: stackName
    });
    receiveMessageResponse = await sqs().receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1
    }).promise();
  } catch (err) {
    t.fail(err);
  }

  t.is(receiveMessageResponse.Messages.length, 1);

  const actualMessage = JSON.parse(receiveMessageResponse.Messages[0].Body);
  const expectedMessage = {
    cumulus_meta: {
      state_machine: stateMachineArn,
      queueName
    },
    meta: {
      queues: {
        [queueName]: queueUrl
      },
      queueExecutionLimits: {
        [queueName]: queueExecutionLimit
      },
      provider: provider,
      collection: collection,
      workflow_name: workflow
    },
    payload: { granules: [granule] }
  };
  t.truthy(actualMessage.cumulus_meta.execution_name);
  t.true(output.endsWith(actualMessage.cumulus_meta.execution_name));
  expectedMessage.cumulus_meta.execution_name = actualMessage.cumulus_meta.execution_name;
  t.deepEqual(expectedMessage, actualMessage);
});

test.serial('the queue receives a correctly formatted workflow message with a PDR', async (t) => {
  const granule = { granuleId: '1', files: [] };
  const {
    queueExecutionLimit,
    queueName,
    queueUrl,
    stateMachineArn,
    workflow,
    templateBucket,
    stackName
  } = t.context;
  const collection = { name: 'test-collection', version: '0.0.0' };
  const provider = { id: 'test-provider' };
  const pdr = { name: randomString(), path: randomString() };
  const arn = randomString();

  let output;
  let receiveMessageResponse;

  try {
    output = await queue.enqueueGranuleIngestMessage({
      granule,
      queueUrl,
      granuleIngestWorkflow: workflow,
      provider,
      collection,
      pdr,
      parentExecutionArn: arn,
      systemBucket: templateBucket,
      stack: stackName
    });
    receiveMessageResponse = await sqs().receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1
    }).promise();
  } catch (err) {
    t.fail(err);
  }

  t.is(receiveMessageResponse.Messages.length, 1);

  const actualMessage = JSON.parse(receiveMessageResponse.Messages[0].Body);
  const expectedMessage = {
    cumulus_meta: {
      state_machine: stateMachineArn,
      parentExecutionArn: arn,
      queueName
    },
    meta: {
      queues: {
        [queueName]: queueUrl
      },
      queueExecutionLimits: {
        [queueName]: queueExecutionLimit
      },
      provider: provider,
      collection: collection,
      pdr: pdr,
      workflow_name: workflow
    },
    payload: { granules: [granule] }
  };
  t.truthy(actualMessage.cumulus_meta.execution_name);
  t.true(output.endsWith(actualMessage.cumulus_meta.execution_name));
  expectedMessage.cumulus_meta.execution_name = actualMessage.cumulus_meta.execution_name;
  t.deepEqual(expectedMessage, actualMessage);
});

test.serial('enqueueGranuleIngestMessage does not transform granule objects ', async (t) => {
  const granule = {
    granuleId: randomId(),
    dataType: randomString(),
    version: randomString(),
    files: [],
    foo: 'bar' // should not be removed or altered
  };
  const { queueUrl } = t.context;
  const collection = { name: 'test-collection', version: '0.0.0' };
  const provider = { id: 'test-provider' };

  const {
    templateBucket,
    stackName,
    workflow
  } = t.context;

  const expectedPayload = {
    granules: [
      granule
    ]
  };

  let response;

  try {
    await queue.enqueueGranuleIngestMessage({
      granule,
      queueUrl,
      granuleIngestWorkflow: workflow,
      provider,
      collection,
      systemBucket: templateBucket,
      stack: stackName
    });
    response = await sqs().receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1
    }).promise();
  } catch (err) {
    t.fail(err);
  }

  const actualMessage = JSON.parse(response.Messages[0].Body);
  t.deepEqual(actualMessage.payload, expectedPayload);
});
