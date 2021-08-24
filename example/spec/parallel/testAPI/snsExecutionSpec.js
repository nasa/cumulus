'use strict';

const { s3ObjectExists, deleteS3Object } = require('@cumulus/aws-client/S3');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { waitForCompletedExecution } = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');

describe('An SNS message is published to the report executions topic', () => {
  let beforeAllError;
  let config;
  let executionKey;
  let workflowExecutionArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
      const workflowExecutionName = 'IngestAndPublishGranule';

      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        workflowExecutionName
      );
    } catch (error) {
      beforeAllError = error;
    }
  });

  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });

  afterAll(async () => {
    await deleteS3Object(config.bucket, executionKey);
  });

  it('for a deleted execution', async () => {
    await waitForCompletedExecution(workflowExecutionArn);
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecutionArn });

    const executionName = workflowExecutionArn.split(':').pop();
    executionKey = `${config.stackName}/test-output/${executionName}.output`;
    const executionExists = await s3ObjectExists({
      Bucket: config.bucket,
      Key: executionKey,
    });
    expect(executionExists).toEqual(true);
  });
});
