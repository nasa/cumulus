/* eslint no-param-reassign: "off" */

'use strict';

const Handlebars = require('handlebars');
const uuidv4 = require('uuid/v4');
const fs = require('fs-extra');
const pLimit = require('p-limit');
const _ = require('lodash');
const {
  aws: { s3, sfn },
  stepFunctions: {
    describeExecution,
    getExecutionHistory
  }
} = require('@cumulus/common');
const {
  models: { Provider, Collection, Rule }
} = require('@cumulus/api');

const sfnStep = require('./sfnStep');
const api = require('./api/api');
const rulesApi = require('./api/rules');
const cmr = require('./cmr.js');
const lambda = require('./lambda');
const granule = require('./granule.js');

/**
 * Wait for the defined number of milliseconds
 *
 * @param {number} waitPeriod - number of milliseconds to wait
 * @returns {Promise.<undefined>} - promise resolves after a given time period
 */
function sleep(waitPeriod) {
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
 * Get the status of a given execution
 *
 * If the execution does not exist, this will return 'RUNNING'.  This seems
 * surprising in the "don't surprise users of your code" sort of way.  If it
 * does not exist then the calling code should probably know that.  Something
 * to be refactored another day.
 *
 * @param {string} executionArn - ARN of the execution
 * @param {Object} [retryOptions] - see the options described [here](https://github.com/tim-kos/node-retry#retrytimeoutsoptions)
 * @returns {Promise<string>} status
 */
async function getExecutionStatus(executionArn, retryOptions) {
  try {
    const execution = await describeExecution(executionArn, retryOptions);
    return execution.status;
  }
  catch (err) {
    throw err;
  }
}

/**
 * Wait for a given execution to complete, then return the status
 *
 * @param {string} executionArn - ARN of the execution
 * @param {number} [timeout=600] - the time, in seconds, to wait for the
 *   execution to reach a non-RUNNING state
 * @returns {string} status
 */
async function waitForCompletedExecution(executionArn, timeout = 600) {
  let executionStatus;
  let iteration = 0;
  const stopTime = Date.now() + (timeout * 1000);
  /* eslint-disable no-await-in-loop */
  do {
    iteration += 1;
    try {
      executionStatus = await getExecutionStatus(executionArn);
    }
    catch (err) {
      if (!(err.code === 'ExecutionDoesNotExist') || iteration > 12) {
        console.log(`waitForCompletedExecution failed: ${err.code}`);
        throw err;
      }
      console.log("Execution does not exist... assuming it's still starting up.");
      executionStatus = 'STARTING';
    }
    if (executionStatus === 'RUNNING') {
      if (!(iteration %12)) console.log('Execution running....'); // Output a 'heartbeat' every minute
    }
    await sleep(5000);
  } while (['RUNNING', 'STARTING'].includes(executionStatus) && Date.now() < stopTime);
  /* eslint-enable no-await-in-loop */

  if (executionStatus === 'RUNNING') {
    const executionHistory = await getExecutionHistory({
      executionArn: executionArn, maxResults: 100
    });
    console.log(`waitForCompletedExecution('${executionArn}') timed out after ${timeout} seconds`);
    console.log('Execution History:');
    console.log(executionHistory);
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
 * Start the workflow and return the execution Arn. Does not wait
 * for workflow completion.
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} workflowName - workflow name
 * @param {string} workflowMsg - workflow message
 * @returns {string} - executionArn
 */
async function startWorkflow(stackName, bucketName, workflowName, workflowMsg) {
  const workflowArn = await getWorkflowArn(stackName, bucketName, workflowName);
  const { executionArn } = await startWorkflowExecution(workflowArn, workflowMsg);

  console.log(`\nStarting workflow: ${workflowName}. Execution ARN ${executionArn}`);

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
 * @param {string} workflowMsg - workflow message
 * @param {number} [timeout=600] - number of seconds to wait for execution to complete
 * @returns {Object} - {executionArn: <arn>, status: <status>}
 */
async function executeWorkflow(stackName, bucketName, workflowName, workflowMsg, timeout = 600) {
  const executionArn = await startWorkflow(stackName, bucketName, workflowName, workflowMsg);

  // Wait for the execution to complete to get the status
  const status = await waitForCompletedExecution(executionArn, timeout);

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
 * @returns {Promise.<number>} number of collections added
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
 * Return a list of collections
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of collection json files
 * @returns {Promise.<Array>} list of collections
 */
async function listCollections(stackName, bucketName, dataDirectory) {
  return setupSeedData(stackName, bucketName, dataDirectory);
}

/**
 * Delete collections from database
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {Array} collections - List of collections to delete
 * @returns {Promise.<number>} number of deleted collections
 */
async function deleteCollections(stackName, bucketName, collections) {
  setProcessEnvironment(stackName, bucketName);

  const promises = collections.map((collection) => {
    const c = new Collection();
    console.log(`\nDeleting collection ${collection.name}__${collection.version}`);
    return c.delete({ name: collection.name, version: collection.version });
  });

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
 * @returns {Promise.<number>} number of providers added
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
 * Return a list of providers
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of provider json files
 * @returns {Promise.<Array>} list of providers
 */
async function listProviders(stackName, bucketName, dataDirectory) {
  return setupSeedData(stackName, bucketName, dataDirectory);
}

/**
 * Delete providers from database
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {Array} providers - List of providers to delete
 * @returns {Promise.<number>} number of deleted providers
 */
async function deleteProviders(stackName, bucketName, providers) {
  setProcessEnvironment(stackName, bucketName);

  const promises = providers.map((provider) => {
    const p = new Provider();
    console.log(`\nDeleting provider ${provider.id}`);
    return p.delete({ id: provider.id });
  });

  return Promise.all(promises).then((ps) => ps.length);
}

/**
 * add rules to database
 *
 * @param {string} config - Test config used to set environmenet variables and template rules data
 * @param {string} dataDirectory - the directory of rules json files
 * @returns {Promise.<number>} number of rules added
 */
async function addRules(config, dataDirectory) {
  const { stackName, bucket } = config;
  const rules = await setupSeedData(stackName, bucket, dataDirectory);

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
 * deletes a rule by name
 *
 * @param {string} name - name of the rule to delete.
 * @returns {Promise.<dynamodbDocClient.delete>} - superclass delete promise
 */
async function _deleteOneRule(name) {
  const r = new Rule();
  return r.get({ name: name }).then((item) => r.delete(item));
}


/**
 * returns a list of rule objects
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} rulesDirectory - The directory continaing rules json files
 * @returns {list} - list of rules found in rulesDirectory
 */
async function rulesList(stackName, bucketName, rulesDirectory) {
  return setupSeedData(stackName, bucketName, rulesDirectory);
}

/**
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {Array} rules - List of rules objects to delete
 * @returns {Promise.<number>} - Number of rules deleted
 */
async function deleteRules(stackName, bucketName, rules) {
  setProcessEnvironment(stackName, bucketName);
  const promises = rules.map((rule) => limit(() => _deleteOneRule(rule.name)));
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
  timeout = 600
) {
  const workflowMsg = await buildWorkflow(
    stackName,
    bucketName,
    workflowName,
    collection,
    provider,
    payload
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
 * @returns {string} - executionArn
 */
async function buildAndStartWorkflow(
  stackName,
  bucketName,
  workflowName,
  collection,
  provider,
  payload
) {
  const workflowMsg = await
  buildWorkflow(stackName, bucketName, workflowName, collection, provider, payload);
  return startWorkflow(stackName, bucketName, workflowName, workflowMsg);
}

/**
 * returns the most recently executed workflows for the workflow type.
 *
 * @param {string} workflowName - name of the workflow to get executions for
 * @param {string} stackName - stack name
 * @param {string} bucket - S3 internal bucket name
 * @param {Integer} maxExecutionResults - max results to return
 * @returns {Array<Object>} array of state function executions.
 */
async function getExecutions(workflowName, stackName, bucket, maxExecutionResults = 10) {
  const kinesisTriggerTestStpFnArn = await getWorkflowArn(stackName, bucket, workflowName);
  const data = await sfn().listExecutions({
    stateMachineArn: kinesisTriggerTestStpFnArn,
    maxResults: maxExecutionResults
  }).promise();
  return (_.orderBy(data.executions, 'startDate', 'desc'));
}

module.exports = {
  api,
  rulesApi,
  testWorkflow,
  executeWorkflow,
  buildAndExecuteWorkflow,
  buildAndStartWorkflow,
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
  listCollections,
  deleteCollections,
  addProviders,
  listProviders,
  deleteProviders,
  conceptExists: cmr.conceptExists,
  getOnlineResources: cmr.getOnlineResources,
  generateCmrFilesForGranules: cmr.generateCmrFilesForGranules,
  addRules,
  deleteRules,
  rulesList,
  sleep,
  timeout: sleep,
  getWorkflowArn,
  getLambdaVersions: lambda.getLambdaVersions,
  getLambdaAliases: lambda.getLambdaAliases,
  waitForConceptExistsOutcome: cmr.waitForConceptExistsOutcome,
  waitUntilGranuleStatusIs: granule.waitUntilGranuleStatusIs,
  getExecutions
};
