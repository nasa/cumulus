'use strict';

const test = require('ava');
const {
  s3,
  recursivelyDeleteS3Bucket
} = require('../aws');
const {
  randomId,
  randomString
} = require('../test-utils');

const {
  getWorkflowArn,
  getWorkflowFile,
  getWorkflowTemplate,
  templateKey,
  workflowTemplateUri
} = require('../workflows');

test.beforeEach(async (t) => {
  t.context.stackName = randomString();
  t.context.system_bucket = randomString();
  t.context.workflow = randomId('workflow');
  t.context.workflowArn = randomId('stateMachine');
  t.context.workflowTemplate = {
    cumulus_meta: {
      state_machine: null
    },
    meta: {
      workflowName: null
    },
    payload: {},
    exception: null
  };

  await s3().createBucket({ Bucket: t.context.system_bucket }).promise();

  t.context.workflowFile = {
    name: t.context.workflow,
    arn: t.context.workflowArn,
    definition: {}
  };

  await Promise.all([
    s3().putObject({
      Bucket: t.context.system_bucket,
      Key: `${t.context.stackName}/workflows/${t.context.workflow}.json`,
      Body: JSON.stringify(t.context.workflowFile)
    }).promise(),
    s3().putObject({
      Bucket: t.context.system_bucket,
      Key: templateKey(t.context.stackName),
      Body: JSON.stringify(t.context.workflowTemplate)
    }).promise()]);
});

test.afterEach(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.system_bucket);
});

test('workflowTemplateUri returns the expected s3 URI', (t) => {
  const expectedUri = `s3://${t.context.system_bucket}/${templateKey(t.context.stackName)}`;
  t.is(expectedUri, workflowTemplateUri(t.context.system_bucket, t.context.stackName));
});

test('getWorkflowTemplate returns the workflow template', async (t) => {
  const expectedTemplate = t.context.workflowTemplate;
  t.deepEqual(expectedTemplate, await getWorkflowTemplate(
    t.context.stackName,
    t.context.system_bucket
  ));
});

test('getWorkflowFile returns the workflow file', async (t) => {
  const expectedFile = t.context.workflowFile;
  t.deepEqual(expectedFile, await getWorkflowFile(
    t.context.stackName,
    t.context.system_bucket,
    t.context.workflow
  ));
});

test('getWorkflowArn returns the arn of the correct workflow', async (t) => {
  const expectedArn = t.context.workflowArn;
  t.is(expectedArn, await getWorkflowArn(
    t.context.stackName,
    t.context.system_bucket,
    t.context.workflow
  ));
});

test('getWorkflowArn throws an error if no workflow file exists with the specified name', async (t) => {
  const err = await t.throwsAsync(
    getWorkflowArn(
      t.context.stackName,
      t.context.system_bucket,
      'missingWorkflow1'
    )
  );

  t.true(err.message.startsWith('The specified key does not exist.'));
});
