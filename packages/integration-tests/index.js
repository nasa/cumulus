'use strict';

const uuidv4 = require('uuid/v4');
const fs = require('fs-extra');
const { s3, sfn } = require('@cumulus/common/aws');
const lambda = require('./lambda');

const executionStatusNumRetries = 20;
const waitPeriodMs = 5000;

/**
 * Wait for the defined number of milliseconds
 *
 * @param {integer} waitPeriod - number of milliseconds to wait
 * @returns {Promise.<undefined>} - promise resolves after a given time period
 */
function timeout(waitPeriod) {
  return new Promise((resolve) => setTimeout(resolve, waitPeriod));
}

/**
 * Get the template JSON from S3 for the workflow
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @returns {Promise.<Object>} template as a JSON object
 */
function getWorkflowTemplate(stackName, bucketName, workflowName) {
  const key = `${stackName}/workflows/${workflowName}.json`;
  return s3().getObject({ Bucket: bucketName, Key: key }).promise()
    .then((templateJson) => JSON.parse(templateJson.Body.toString()));
}

/**
 * Get the workflow ARN for the given workflow from the
 * template stored on S3
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @returns {Promise.<string>} - workflow arn
 */
function getWorkflowArn(stackName, bucketName, workflowName) {
  return getWorkflowTemplate(stackName, bucketName, workflowName)
    .then((template) => template.cumulus_meta.state_machine);
}

/**
 * Get the execution status (i.e. running, completed, etc)
 * for the given execution
 *
 * @param {string} executionArn - ARN of the execution
 * @returns {string} status
 */
function getExecutionStatus(executionArn) {
  return sfn().describeExecution({ executionArn }).promise()
    .then((status) => status.status);
}

/**
 * Wait for a given execution to complete, then return the status
 *
 * @param {string} executionArn - ARN of the execution
 * @returns {string} status
 */
async function waitForCompletedExecution(executionArn) {
  let executionStatus = await getExecutionStatus(executionArn);
  let statusCheckCount = 0;

  // While execution is running, check status on a time interval
  while (executionStatus === 'RUNNING' && statusCheckCount < executionStatusNumRetries) {
    await timeout(waitPeriodMs);
    executionStatus = await getExecutionStatus(executionArn);
    statusCheckCount++;
  }

  if (executionStatus === 'RUNNING' && statusCheckCount >= executionStatusNumRetries) {
    //eslint-disable-next-line max-len
    console.log(`Execution status check timed out, exceeded ${executionStatusNumRetries} status checks.`);
  }

  return executionStatus;
}

/**
 * Kick off a workflow execution
 *
 * @param {string} workflowArn - ARN for the workflow
 * @param {string} inputFile - path to input JSON
 * @returns {Promise.<Object>} execution details: {executionArn, startDate}
 */
async function startWorkflowExecution(workflowArn, inputFile) {
  const rawInput = await fs.readFile(inputFile, 'utf8');

  const parsedInput = JSON.parse(rawInput);

  // Give this execution a unique name
  parsedInput.cumulus_meta.execution_name = uuidv4();
  parsedInput.cumulus_meta.workflow_start_time = Date.now();
  parsedInput.cumulus_meta.state_machine = workflowArn;

  const workflowParams = {
    stateMachineArn: workflowArn,
    input: JSON.stringify(parsedInput),
    name: parsedInput.cumulus_meta.execution_name
  };

  return sfn().startExecution(workflowParams).promise();
}

/**
 * Execute the given workflow.
 * Wait for workflow to complete to get the status
 * Return the execution arn and the workflow status.
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {string} inputFile - path to input JSON file
 * @returns {Object} - {executionArn: <arn>, status: <status>}
 */
async function executeWorkflow(stackName, bucketName, workflowName, inputFile) {
  const workflowArn = await getWorkflowArn(stackName, bucketName, workflowName);
  const execution = await startWorkflowExecution(workflowArn, inputFile);
  const executionArn = execution.executionArn;

  console.log(`Executing workflow: ${workflowName}. Execution ARN ${executionArn}`);

  // Wait for the execution to complete to get the status
  const status = await waitForCompletedExecution(executionArn);

  return { status, executionArn };
}

/**
 * Test the given workflow and report whether the workflow failed or succeeded
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {string} inputFile - path to input JSON file
 * @returns {*} undefined
 */
async function testWorkflow(stackName, bucketName, workflowName, inputFile) {
  try {
    const workflowStatus = await executeWorkflow(stackName, bucketName, workflowName, inputFile);

    if (workflowStatus.status === 'SUCCEEDED') {
      console.log(`Workflow ${workflowName} execution succeeded.`);
    }
    else {
      console.log(`Workflow ${workflowName} execution failed with state: ${workflowStatus.status}`);
    }
  }
  catch (err) {
    console.log(`Error executing workflow ${workflowName}. Error: ${err}`);
  }
}

module.exports = {
  testWorkflow,
  executeWorkflow,
  getLambdaOutput: lambda.getLambdaOutput
};
