'use strict';

const get = require('lodash/get');
const merge = require('lodash/merge');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');

const {
  templateKey,
  getWorkflowFileKey,
} = require('@cumulus/common/workflows');
const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const collectionsApi = require('@cumulus/api-client/collections');
const providersApi = require('@cumulus/api-client/providers');
const { getExecution } = require('@cumulus/api-client/executions');
const {
  sfn,
} = require('@cumulus/aws-client/services');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');

const { waitForApiStatus } = require('./apiUtils');

function isReingestExecution(taskInput) {
  return get(
    taskInput,
    'cumulus_meta.cumulus_context.reingestGranule',
    false
  );
}

function isExecutionForGranuleId(taskInput, granuleId) {
  return get(taskInput, 'payload.granules[0].granuleId') === granuleId;
}

/**
 * Given a Cumulus Message and a granuleId, test if the message is a re-ingest
 * of the granule.
 *
 * This is used as the `findExecutionFn` parameter of the
 * `waitForTestExecutionStart` function.
 *
 * @param {Object} taskInput - a full Cumulus Message
 * @param {Object} findExecutionFnParams
 * @param {string} findExecutionFnParams.granuleId
 * @returns {boolean}
 */
function isReingestExecutionForGranuleId(taskInput, { granuleId }) {
  return isReingestExecution(taskInput) &&
    isExecutionForGranuleId(taskInput, granuleId);
}

/**
 * Kick off a workflow execution
 *
 * @param {string} workflowArn - ARN for the workflow
 * @param {Object} workflowMsg - workflow message
 * @returns {Promise.<Object>} execution details: {executionArn, startDate}
 */

async function startWorkflowExecution(workflowArn, workflowMsg) {
  // Give this execution a unique name
  workflowMsg.cumulus_meta.execution_name = uuidv4();
  workflowMsg.cumulus_meta.workflow_start_time = Date.now();
  workflowMsg.cumulus_meta.state_machine = workflowArn;

  const workflowParams = {
    stateMachineArn: workflowArn,
    input: JSON.stringify(workflowMsg),
    name: workflowMsg.cumulus_meta.execution_name,
  };

  return await sfn().startExecution(workflowParams);
}

/**
 * Start the workflow and return the execution Arn. Does not wait
 * for workflow completion.
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {Object} workflowMsg - workflow message
 * @returns {string} - executionArn
 */
async function startWorkflow(stackName, bucketName, workflowName, workflowMsg) {
  const { arn: workflowArn } = await getJsonS3Object(
    bucketName,
    getWorkflowFileKey(stackName, workflowName)
  );
  const { executionArn } = await startWorkflowExecution(workflowArn, workflowMsg);

  console.log(`Starting workflow: ${workflowName}. Execution ARN ${executionArn}`);

  return executionArn;
}

/**
 * Execute the given workflow.
 * Wait for workflow to complete to get the status
 * Return the execution arn and the workflow status.
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {Object} workflowMsg - workflow message
 * @param {number} [timeout=600] - number of seconds to wait for execution to complete
 * @returns {Object} - {executionArn: <arn>, status: <status>}
 */
async function executeWorkflow(stackName, bucketName, workflowName, workflowMsg, timeout = 600) {
  const executionArn = await startWorkflow(stackName, bucketName, workflowName, workflowMsg);
  // Wait for the execution to complete to get the status
  const record = await waitForApiStatus(
    getExecution,
    { prefix: stackName, arn: executionArn },
    ['completed', 'failed'],
    { maxTimeout: timeout * 1000 }
  );

  return { status: record.status, executionArn };
}

/**
 * build workflow message
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {Object} collection - collection information
 * @param {Object} collection.name - collection name
 * @param {Object} collection.version - collection version
 * @param {Object} provider - provider information
 * @param {Object} provider.id - provider id
 * @param {Object} payload - payload information
 * @param {Object} meta - additional keys to add to meta field
 * @returns {Object} workflow message
 */
async function buildWorkflow(
  stackName,
  bucketName,
  workflowName,
  collection,
  provider,
  payload,
  meta
) {
  const template = await getJsonS3Object(bucketName, templateKey(stackName));

  if (collection) {
    const collectionsApiResponse = await collectionsApi.getCollection({
      prefix: stackName,
      collectionName: collection.name,
      collectionVersion: collection.version,
    });
    if (collectionsApiResponse.statusCode) {
      throw new Error(`Collections API responded with error on buildWorkflow ${JSON.stringify(collectionsApiResponse)}`);
    }
    template.meta.collection = collectionsApiResponse;
  } else {
    template.meta.collection = {};
  }

  if (provider) {
    const providersApiResponse = await providersApi.getProvider(
      {
        prefix: stackName,
        providerId: provider.id,
      }
    );
    if (providersApiResponse.statusCode !== 200) {
      throw new Error(`Providers API responded with error on buildWorkflow ${JSON.stringify(providersApiResponse)}`);
    }
    template.meta.provider = JSON.parse(providersApiResponse.body);
    template.meta.provider.password = provider.password;
  } else {
    template.meta.provider = {};
  }

  template.meta.workflow_name = workflowName;
  template.meta = merge(template.meta, meta);
  template.payload = payload || {};

  return template;
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
    const rawInput = await fs.readFile(inputFile, 'utf8');
    const parsedInput = JSON.parse(rawInput);
    const workflowStatus = await executeWorkflow(stackName, bucketName, workflowName, parsedInput);

    if (workflowStatus.status === 'completed') {
      console.log(`Workflow ${workflowName} execution succeeded.`);
    } else {
      console.log(`Workflow ${workflowName} execution failed with state: ${workflowStatus.status}`);
    }
  } catch (error) {
    console.log(`Error executing workflow ${workflowName}. Error: ${error}`);
  }
}

/**
 * build workflow message and execute the workflow
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {Object} collection - collection information
 * @param {Object} collection.name - collection name
 * @param {Object} collection.version - collection version
 * @param {Object} provider - provider information
 * @param {Object} provider.id - provider id
 * @param {Object} payload - payload information
 * @param {Object} meta - additional keys to add to meta field
 * @param {number} [timeout=600] - number of seconds to wait for execution to complete
 * @returns {Object} - {executionArn: <arn>, status: <status>}
 */
async function buildAndExecuteWorkflow(
  stackName,
  bucketName,
  workflowName,
  collection,
  provider,
  payload,
  meta = {},
  timeout = 600
) {
  const workflowMsg = await buildWorkflow(
    stackName,
    bucketName,
    workflowName,
    collection,
    provider,
    payload,
    meta
  );
  return executeWorkflow(stackName, bucketName, workflowName, workflowMsg, timeout);
}

/**
 * build workflow message and start the workflow. Does not wait
 * for workflow completion.
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {Object} collection - collection information
 * @param {Object} collection.name - collection name
 * @param {Object} collection.version - collection version
 * @param {Object} provider - provider information
 * @param {Object} provider.id - provider id
 * @param {Object} payload - payload information
 * @param {Object} meta - additional keys to add to meta field
 * @returns {string} - executionArn
 */
async function buildAndStartWorkflow(
  stackName,
  bucketName,
  workflowName,
  collection,
  provider,
  payload,
  meta = {}
) {
  const workflowMsg = await
  buildWorkflow(stackName, bucketName, workflowName, collection, provider, payload, meta);
  return startWorkflow(stackName, bucketName, workflowName, workflowMsg);
}

async function stateMachineExists(stateMachineName) {
  const sfnList = await sfn().listStateMachines({ maxResults: 1 });
  const stateMachines = get(sfnList, 'stateMachines', []);
  if (stateMachines.length !== 1) {
    console.log('No state machine found');
    return false;
  }
  const stateMachineArn = stateMachines[0].stateMachineArn.replace(stateMachines[0].name, stateMachineName);
  try {
    await StepFunctions.describeStateMachine({ stateMachineArn });
  } catch (error) {
    if (error instanceof StepFunctions.StateMachineDoesNotExist) return false;
    throw error;
  }
  return true;
}

module.exports = {
  testWorkflow,
  buildAndStartWorkflow,
  buildAndExecuteWorkflow,
  isReingestExecutionForGranuleId,
  stateMachineExists,
};
