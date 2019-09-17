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
  getWorkflowList,
  getWorkflowTemplate
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

  const universalTemplateUri = `s3://${t.context.system_bucket}/${t.context.stackName}/workflows/template.json`;
  await s3().createBucket({ Bucket: t.context.system_bucket }).promise();
  t.context.workflowList = [{
    name: t.context.workflow,
    arn: t.context.workflowArn,
    template: universalTemplateUri,
    definition: {}
  },
  {
    name: 'irrelevantWorkflow',
    arn: 'irrelevantWorkflowArn',
    template: universalTemplateUri,
    definition: {}
  }];
  await Promise.all([
    s3().putObject({
      Bucket: t.context.system_bucket,
      Key: `${t.context.stackName}/workflows/list.json`,
      Body: JSON.stringify(t.context.workflowList)
    }).promise(),
    s3().putObject({
      Bucket: t.context.system_bucket,
      Key: `${t.context.stackName}/workflows/template.json`,
      Body: JSON.stringify(t.context.workflowTemplate)
    }).promise()]);
});

test.afterEach(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.system_bucket);
});

test('getWorkflowTemplate returns the workflow template', async (t) => {
  const expectedTemplate = t.context.workflowTemplate;
  t.deepEqual(expectedTemplate, await getWorkflowTemplate(
    t.context.stackName,
    t.context.system_bucket
  ));
});

test('getWorkflowList returns the list of workflows', async (t) => {
  const expectedList = t.context.workflowList;
  t.deepEqual(expectedList, await getWorkflowList(t.context.stackName, t.context.system_bucket));
});

test('getWorkflowArn returns the arn of the correct workflow', async (t) => {
  const expectedArn = t.context.workflowArn;
  t.is(expectedArn, await getWorkflowArn(
    t.context.stackName,
    t.context.system_bucket,
    t.context.workflow
  ));
});

test('getWorkflowArn throws an error if more than one workflow exists with the specified name', async (t) => {
  const newList = [t.context.workflowList[0], t.context.workflowList[0]];
  await s3().putObject({
    Bucket: t.context.system_bucket,
    Key: `${t.context.stackName}/workflows/list.json`,
    Body: JSON.stringify(newList)
  }).promise();
  await t.throwsAsync(
    getWorkflowArn(
      t.context.stackName,
      t.context.system_bucket,
      t.context.workflow
    ),
    `Found more than one workflow with name ${t.context.workflow}!`
  );
});

test('getWorkflowArn throws an error if no workflow exists with the specified name', async (t) => {
  const newList = [t.context.workflowList[1]];
  await s3().putObject({
    Bucket: t.context.system_bucket,
    Key: `${t.context.stackName}/workflows/list.json`,
    Body: JSON.stringify(newList)
  }).promise();
  await t.throwsAsync(
    getWorkflowArn(
      t.context.stackName,
      t.context.system_bucket,
      t.context.workflow
    ),
    `Found no workflows with name ${t.context.workflow}!`
  );
});
