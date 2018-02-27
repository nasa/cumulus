'use strict';

const aws = require('@cumulus/common/aws');
const uuidv4 = require('uuid/v4');
const fs = require('fs-extra');

const waitPeriodMs = 5000;

/**
 * Wait for the defined number of milliseconds
 *
 * @param {integer} waitPeriod - number of milliseconds to wait
 * @returns {Promise} ?????
 */
function timeout(waitPeriod) {
  return new Promise((resolve) => setTimeout(resolve, waitPeriod));
}

/**
 * Get the list of workflows for the stack
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @returns {Object} list as a JSON object
 */
async function getWorkflowList(stackName, bucketName) {
  const key = `${stackName}/workflows/list.json`;

  const workflowJson = await aws.s3().getObject({ Bucket: bucketName, Key: key }).promise();

  return JSON.parse(workflowJson.Body.toString());
}

/**
 * Get the template JSON from S3 for the workflow
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @returns {Object} template as a JSON object
 */
async function getWorkflowTemplate(stackName, bucketName, workflowName) {
  const key = `${stackName}/workflows/${workflowName}.json`;
  const templateJson = await aws.s3().getObject({ Bucket: bucketName, Key: key }).promise();

  return JSON.parse(templateJson.Body.toString());
}

/**
 * Get the workflow ARN for the given workflow from the
 * template stored on S3
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @returns {string} - workflow arn
 */
async function getWorkflowArn(stackName, bucketName, workflowName) {
  const template = await getWorkflowTemplate(stackName, bucketName, workflowName);

  return template.cumulus_meta.state_machine;
}

/**
 * Get the execution status (i.e. running, completed, etc)
 * for the given execution
 *
 * @param {string} executionArn - ARN of the execution
 * @returns {string} status
 */
async function getExecutionStatus(executionArn) {
  const status = await aws.sfn().describeExecution({
    executionArn: executionArn
  }).promise();

  return status.status;
}

/**
 * Wait for a given execution to complete, then return the status
 *
 * @param {string} executionArn - ARN of the execution
 * @returns {string} status
 */
async function waitForCompletedExecution(executionArn) {
  let executionStatus = await getExecutionStatus(executionArn);

  // While execution is running, check status on a time interval
  while (executionStatus === 'RUNNING') {
    await timeout(waitPeriodMs);
    executionStatus = await getExecutionStatus(executionArn);
  }

  return executionStatus;
}

/**
 * Kick off a workflow execution
 *
 * @param {string} workflowArn - ARN for the workflow
 * @param {string} inputFile - path to input JSON
 * @returns {Object} execution details: {executionArn, startDate}
 */
async function startWorkflowExecution(workflowArn, inputFile) {
  const rawInput = await fs.readFile(inputFile, 'utf8');

  const parsedInput = JSON.parse(rawInput);

  // Give this execution a unique name
  parsedInput.cumulus_meta.execution_name = uuidv4();
  parsedInput.cumulus_meta.workflow_start_time = null;

  const workflowParams = {
    stateMachineArn: workflowArn,
    input: JSON.stringify(parsedInput),
    name: parsedInput.cumulus_meta.execution_name
  };

  return aws.sfn().startExecution(workflowParams).promise();
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

  console.log(`Executing workflow: ${workflowName}. Execution ARN ${execution.executionArn}`);

  // Wait for the execution to complete to get the status
  const status = await waitForCompletedExecution(execution.executionArn);

  return { status: status, arn: execution.executionArn };
}

/**
 * Test the given workflow and report whether the workflow failed or succeeded
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {string} inputFile - path to input JSON file
 * @returns {*} none
 */
async function testWorkflow(stackName, bucketName, workflowName, inputFile) {
  try {
    const workflowStatus = await executeWorkflow(stackName, bucketName, workflowName, inputFile);

    if (workflowStatus.status === 'SUCCEEDED') {
      console.log('Workflow ' + workflowName + ' execution succeeded.');
    }
    else {
      console.log('Workflow ' + workflowName +
                  ' execution failed with state: ' + workflowStatus.status);
    }
  }
  catch (err) {
    console.log('Error executing workflow ' + workflowName + ' ' + err);
  }
}

exports.testWorkflow = testWorkflow;
