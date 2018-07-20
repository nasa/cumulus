/* eslint-disable no-param-reassign */

'use strict';

const Handlebars = require('handlebars');
const uuidv4 = require('uuid/v4');
const fs = require('fs-extra');
const pLimit = require('p-limit');
const { s3, sfn } = require('@cumulus/common/aws');
const sfnStep = require('./sfnStep');
const { Provider, Collection, Rule } = require('@cumulus/api/models');

const api = require('./api');
const cmr = require('./cmr.js');

const executionStatusNumRetries = 100;
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
    .then((status) => status.status)
    .catch((e) => {
      // the execution may not be started yet
      if (e.code === 'ExecutionDoesNotExist') return 'RUNNING';
      throw e;
    });
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
  /* eslint-disable no-await-in-loop */
  while (executionStatus === 'RUNNING' && statusCheckCount < executionStatusNumRetries) {
    await timeout(waitPeriodMs);
    executionStatus = await getExecutionStatus(executionArn);
    statusCheckCount += 1;
  }
  /* eslint-enable no-await-in-loop */

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
 * @param {string} workflowMsg - workflow message
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
    name: workflowMsg.cumulus_meta.execution_name
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
 * @param {string} workflowMsg - workflow message
 * @returns {Object} - {executionArn: <arn>, status: <status>}
 */
async function executeWorkflow(stackName, bucketName, workflowName, workflowMsg) {
  const workflowArn = await getWorkflowArn(stackName, bucketName, workflowName);
  const { executionArn } = await startWorkflowExecution(workflowArn, workflowMsg);

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
    const rawInput = await fs.readFile(inputFile, 'utf8');
    const parsedInput = JSON.parse(rawInput);
    const workflowStatus = await executeWorkflow(stackName, bucketName, workflowName, parsedInput);

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

/**
 * set process environment necessary for database transactions
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @returns {*} undefined
 */
function setProcessEnvironment(stackName, bucketName) {
  process.env.internal = bucketName;
  process.env.bucket = bucketName;
  process.env.stackName = stackName;
  process.env.kinesisConsumer = `${stackName}-kinesisConsumer`;
  process.env.CollectionsTable = `${stackName}-CollectionsTable`;
  process.env.ProvidersTable = `${stackName}-ProvidersTable`;
  process.env.RulesTable = `${stackName}-RulesTable`;
}

const concurrencyLimit = process.env.CONCURRENCY || 3;
const limit = pLimit(concurrencyLimit);

/**
 * Set environment variables and read in seed files from dataDirectory
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of collection json files
 * @returns {Array} List of objects to seed in the database
 */
async function setupSeedData(stackName, bucketName, dataDirectory) {
  setProcessEnvironment(stackName, bucketName);
  const filenames = await fs.readdir(dataDirectory);
  const seedItems = [];
  filenames.forEach((filename) => {
    if (filename.match(/.*\.json/)) {
      const item = JSON.parse(fs.readFileSync(`${dataDirectory}/${filename}`, 'utf8'));
      seedItems.push(item);
    }
  });
  return seedItems;
}

/**
 * add collections to database
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of collection json files
 * @returns {Promise.<integer>} number of collections added
 */
async function addCollections(stackName, bucketName, dataDirectory) {
  const collections = await setupSeedData(stackName, bucketName, dataDirectory);
  const promises = collections.map((collection) => limit(() => {
    const c = new Collection();
    console.log(`adding collection ${collection.name}___${collection.version}`);
    return c.delete({ name: collection.name, version: collection.version })
      .then(() => c.create(collection));
  }));
  return Promise.all(promises).then((cs) => cs.length);
}

/**
 * add providers to database.
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of provider json files
 * @param {string} s3Host - bucket name to be used as the provider host for
 * S3 providers. This will override the host from the seed data. Defaults to null,
 * meaning no override.
 * @returns {Promise.<integer>} number of providers added
 */
async function addProviders(stackName, bucketName, dataDirectory, s3Host = null) {
  const providers = await setupSeedData(stackName, bucketName, dataDirectory);

  const promises = providers.map((provider) => limit(() => {
    const p = new Provider();
    if (s3Host && provider.protocol === 's3') {
      provider.host = s3Host;
    }
    console.log(`adding provider ${provider.id}`);
    return p.delete({ id: provider.id }).then(() => p.create(provider));
  }));
  return Promise.all(promises).then((ps) => ps.length);
}

/**
 * add rules to database
 *
 * @param {string} config - Test config used to set environmenet variables and template rules data
 * @param {string} dataDirectory - the directory of rules json files
 * @returns {Promise.<integer>} number of rules added
 */
async function addRules(config, dataDirectory) {
  const { stackName, bucketName } = config;
  const rules = await setupSeedData(stackName, bucketName, dataDirectory);

  const promises = rules.map((rule) => limit(() => {
    const ruleTemplate = Handlebars.compile(JSON.stringify(rule));
    const templatedRule = JSON.parse(ruleTemplate(config));
    const r = new Rule();
    console.log(`adding rule ${templatedRule.name}`);
    return r.create(templatedRule);
  }));
  return Promise.all(promises).then((rs) => rs.length);
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
 * @returns {Promise.<string>} workflow message
 */
async function buildWorkflow(stackName, bucketName, workflowName, collection, provider, payload) {
  setProcessEnvironment(stackName, bucketName);
  const template = await getWorkflowTemplate(stackName, bucketName, workflowName);
  let collectionInfo = {};
  if (collection) {
    collectionInfo = await new Collection()
      .get({ name: collection.name, version: collection.version });
  }
  let providerInfo = {};
  if (provider) {
    providerInfo = await new Provider().get({ id: provider.id });
  }
  template.meta.collection = collectionInfo;
  template.meta.provider = providerInfo;
  template.payload = payload || {};
  return template;
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
 * @returns {Object} - {executionArn: <arn>, status: <status>}
 */
async function buildAndExecuteWorkflow(
  stackName,
  bucketName,
  workflowName,
  collection,
  provider,
  payload
) {
  const workflowMsg = await
  buildWorkflow(stackName, bucketName, workflowName, collection, provider, payload);
  return executeWorkflow(stackName, bucketName, workflowName, workflowMsg);
}

module.exports = {
  api,
  testWorkflow,
  executeWorkflow,
  buildAndExecuteWorkflow,
  getWorkflowTemplate,
  waitForCompletedExecution,
  ActivityStep: sfnStep.ActivityStep,
  LambdaStep: sfnStep.LambdaStep,
  /**
   * @deprecated Since version 1.3. To be deleted version 2.0.
   * Use sfnStep.LambdaStep.getStepOutput instead.
   */
  getLambdaOutput: new sfnStep.LambdaStep().getStepOutput,
  addCollections,
  addProviders,
  conceptExists: cmr.conceptExists,
  getOnlineResources: cmr.getOnlineResources,
  generateCmrFilesForGranules: cmr.generateCmrFilesForGranules,
  addRules,
  timeout,
  getWorkflowArn
};
