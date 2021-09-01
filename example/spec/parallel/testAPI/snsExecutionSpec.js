'use strict';

const { getJsonS3Object, deleteS3Object, s3ObjectExists } = require('@cumulus/aws-client/S3');
const { waitForCompletedExecution } = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');

describe('An SNS message is published to the report executions topic', () => {
  let beforeAllError;
  let config;
  let executionKey;
  let executionName;
  let workflowExecution;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
      const workflowExecutionName = 'HelloWorldWorkflow';

      workflowExecution = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        workflowExecutionName
      );
      await waitForCompletedExecution(workflowExecution);
      executionName = workflowExecution.split(':').pop();
      executionKey = `${config.stackName}/test-output/${executionName}.output`;
      await s3ObjectExists({
        Bucket: config.bucket,
        Key: executionKey,
      });
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

  it('for a created execution', async () => {
    const savedMessage = await getJsonS3Object(config.bucket, executionKey);
    const message = JSON.parse(savedMessage.Records[0].Sns.Message);
    expect(message.arn).toEqual(workflowExecution);
    expect(message.name).toEqual(executionName);
  });
});
