/* eslint no-param-reassign: "off" */

'use strict';

const orderBy = require('lodash.orderby');
const path = require('path');
const cloneDeep = require('lodash.clonedeep');
const isEqual = require('lodash.isequal');
const isString = require('lodash.isstring');
const merge = require('lodash.merge');
const Handlebars = require('handlebars');
const uuidv4 = require('uuid/v4');
const fs = require('fs-extra');
const pWaitFor = require('p-wait-for');
const pMap = require('p-map');
const moment = require('moment');

const {
  dynamodb,
  ecs,
  sfn
} = require('@cumulus/aws-client/services');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { getWorkflowTemplate, getWorkflowArn } = require('@cumulus/common/workflows');
const { readJsonFile } = require('@cumulus/common/FileUtils');
const { globalReplace } = require('@cumulus/common/string');
const { deprecate, sleep } = require('@cumulus/common/util');
const ProvidersModel = require('@cumulus/api/models/providers');
const RulesModel = require('@cumulus/api/models/rules');

const api = require('./api/api');
const collectionsApi = require('./api/collections');
const providersApi = require('./api/providers');
const rulesApi = require('./api/rules');
const emsApi = require('./api/ems');
const executionsApi = require('./api/executions');
const granulesApi = require('./api/granules');
const EarthdataLogin = require('./api/EarthdataLogin');
const distributionApi = require('./api/distribution');
const cmr = require('./cmr.js');
const lambda = require('./lambda');
const waitForDeployment = require('./lambdas/waitForDeployment');
const { ActivityStep, LambdaStep } = require('./sfnStep');

const waitPeriodMs = 1000;

const maxWaitForStartedExecutionSecs = 60 * 5;

const lambdaStep = new LambdaStep();

/**
 * Wait for an AsyncOperation to reach a given status
 *
 * Retries every 2 seconds until the expected status has been reached or the
 *   number of retries has been exceeded.
 *
 * @param {Object} params - params
 * @param {string} params.TableName - the name of the AsyncOperations DynamoDB
 *   table
 * @param {string} params.id - the id of the AsyncOperation
 * @param {string} params.status - the status to wait for
 * @param {number} params.retries - the number of times to retry Default: 10
 * @returns {Promise<Object>} - the AsyncOperation object
 */
async function waitForAsyncOperationStatus({
  TableName,
  id,
  status,
  retries = 10
}) {
  const { Item } = await dynamodb().getItem({
    TableName,
    Key: { id: { S: id } }
  }).promise();

  if (Item.status.S === status || retries <= 0) return Item;

  await sleep(2000);
  return waitForAsyncOperationStatus({
    TableName,
    id,
    status,
    retries: retries - 1
  });
}

/**
 * Return the ARN of the Cumulus ECS cluster
 *
 * @param {string} stackName - the Cumulus stack name
 * @returns {string|undefined} - the cluster ARN or undefined if not found
 */
async function getClusterArn(stackName) {
  const { clusterArns } = await ecs().listClusters().promise();

  const matchingArns = clusterArns.filter((arn) => arn.includes(`${stackName}-CumulusECSCluster`));

  if (matchingArns.length !== 1) {
    throw new Error(`Expected to find 1 cluster but found: ${matchingArns}`);
  }

  return matchingArns[0];
}

async function getExecutionInput(executionArn) {
  const { input } = await StepFunctions.describeExecution({ executionArn });
  return input;
}

/**
 * Fetch the output of a given execution
 *
 * @param {string} executionArn
 * @returns {Promise<Object>} the output of the execution
 */
const getExecutionOutput = (executionArn) =>
  StepFunctions.describeExecution({ executionArn })
    .then((execution) => execution.output)
    .then(JSON.parse)
    .then(StepFunctions.pullStepFunctionEvent);

async function getExecutionInputObject(executionArn) {
  return JSON.parse(await getExecutionInput(executionArn));
}

/**
 * Get the status of a given execution
 *
 * If the execution does not exist, this will return 'STARTING'.
 *
 * @param {string} executionArn - ARN of the execution
 * @returns {Promise<string>} status
 */
async function getExecutionStatus(executionArn) {
  try {
    const { status } = await StepFunctions.describeExecution({ executionArn });
    return status;
  } catch (err) {
    if (err.code === 'ExecutionDoesNotExist') return 'STARTING';
    throw err;
  }
}

/**
 * Wait for a given execution to complete, then return the status
 *
 * @param {string} executionArn - ARN of the execution
 * @param {number} [timeout=600] - the time, in seconds, to wait for the
 *   execution to reach a terminal state
 * @returns {string} status
 */
async function waitForCompletedExecution(executionArn, timeout = 600) {
  let status;

  await pWaitFor(
    async () => {
      status = await getExecutionStatus(executionArn);
      console.log(`${executionArn} status: ${status}`);
      return status !== 'STARTING' && status !== 'RUNNING';
    },
    {
      interval: 2000,
      timeout: timeout * 1000
    }
  );

  return status;
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
 * @param {Object} workflowMsg - workflow message
 * @returns {string} - executionArn
 */
async function startWorkflow(stackName, bucketName, workflowName, workflowMsg) {
  const workflowArn = await getWorkflowArn(stackName, bucketName, workflowName);
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
    } else {
      console.log(`Workflow ${workflowName} execution failed with state: ${workflowStatus.status}`);
    }
  } catch (err) {
    console.log(`Error executing workflow ${workflowName}. Error: ${err}`);
  }
}

/**
 * set process environment necessary for database transactions
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 */
function setProcessEnvironment(stackName, bucketName) {
  process.env.system_bucket = bucketName;
  process.env.stackName = stackName;
  process.env.messageConsumer = `${stackName}-messageConsumer`;
  process.env.KinesisInboundEventLogger = `${stackName}-KinesisInboundEventLogger`;
  process.env.CollectionsTable = `${stackName}-CollectionsTable`;
  process.env.ProvidersTable = `${stackName}-ProvidersTable`;
  process.env.RulesTable = `${stackName}-RulesTable`;
}

/**
 * Load and parse all of the JSON files from a directory
 *
 * @param {string} sourceDir - the directory containing the JSON files to load
 * @returns {Promise<Array<*>>} the parsed JSON files
 */
const readJsonFilesFromDir = async (sourceDir) => {
  const allFiles = await fs.readdir(sourceDir);
  const jsonFiles = allFiles.filter((f) => f.endsWith('.json'));
  const absoluteFiles = jsonFiles.map((f) => path.join(sourceDir, f));
  return Promise.all(absoluteFiles.map(readJsonFile));
};

/**
 * Set environment variables and read in seed files from dataDirectory
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of collection json files
 * @returns {Promise<Array>} List of objects to seed in the database
 */
function setupSeedData(stackName, bucketName, dataDirectory) {
  setProcessEnvironment(stackName, bucketName);
  return readJsonFilesFromDir(dataDirectory);
}

/**
 * Given a Cumulus collection configuration, return a list of the filetype
 * configs with their `url_path`s updated.
 *
 * @param {Object} collection - a Cumulus collection
 * @param {string} customFilePath - path to be added to the end of the url_path
 * @returns {Array<Object>} a list of collection filetype configs
 */
const addCustomUrlPathToCollectionFiles = (collection, customFilePath) =>
  collection.files.map((file) => {
    let urlPath;
    if (isString(file.url_path)) {
      urlPath = `${file.url_path}/`;
    } else if (isString(collection.url_path)) {
      urlPath = `${collection.url_path}/`;
    } else {
      urlPath = '';
    }

    return {
      ...file,
      url_path: `${urlPath}${customFilePath}/`
    };
  });

/**
 * Update a collection with a custom file path, duplicate handling, and name
 * updated with the postfix.
 *
 * @param {Object} params
 * @param {Object} params.collection - a collection configuration
 * @param {string} params.customFilePath - path to be added to the end of the
 *   url_path
 * @param {string} params.duplicateHandling - duplicate handling setting
 * @param {string} params.postfix - a string to be appended to the end of the
 *   name
 * @returns {Object} an updated collection
 */
const buildCollection = (params = {}) => {
  const {
    collection, customFilePath, duplicateHandling, postfix
  } = params;

  const updatedCollection = { ...collection };

  if (postfix) {
    updatedCollection.name += postfix;
  }

  if (customFilePath) {
    updatedCollection.files = addCustomUrlPathToCollectionFiles(
      collection,
      customFilePath
    );
  }

  if (duplicateHandling) {
    updatedCollection.duplicateHandling = duplicateHandling;
  }

  return updatedCollection;
};

/**
 * Add a collection to Cumulus
 *
 * @param {string} stackName - the prefix of the Cumulus stack
 * @param {Object} collection - a Cumulus collection
 * @returns {Promise<undefined>}
 */
const addCollection = async (stackName, collection) => {
  await collectionsApi.deleteCollection(
    stackName,
    collection.name,
    collection.version
  );
  await collectionsApi.createCollection(stackName, collection);
};

/**
 * Load a collection from a JSON file and update it
 *
 * @param {Object} params
 * @param {string} params.filename - the JSON file containing the collection
 * @param {string} params.customFilePath
 * @param {string} params.duplicateHandling
 * @param {string} params.postfix
 * @returns {Object} a collection
 */
const loadCollection = async (params = {}) =>
  readJsonFile(params.filename)
    .then((collection) => buildCollection({ ...params, collection }));

/**
 * add collections to database
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of collection json files
 * @param {string} [postfix] - string to append to collection name
 * @param {string} [customFilePath]
 * @param {string} [duplicateHandling]
 * @returns {Promise<number>} number of collections added
 */
async function addCollections(stackName, bucketName, dataDirectory, postfix,
  customFilePath, duplicateHandling) {
  // setProcessEnvironment is not needed by this function, but other code
  // depends on this undocumented side effect
  setProcessEnvironment(stackName, bucketName);

  const rawCollections = await readJsonFilesFromDir(dataDirectory);

  const collections = rawCollections.map(
    (collection) => buildCollection({
      collection,
      customFilePath,
      duplicateHandling,
      postfix
    })
  );

  await Promise.all(
    collections.map((collection) => addCollection(stackName, collection))
  );

  return rawCollections.length;
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
  deprecate(
    '@cumulus/integration-tests/index.listCollections',
    '1.18.0',
    '@cumulus/integration-tests/index.readJsonFilesFromDir'
  );
  return setupSeedData(stackName, bucketName, dataDirectory);
}

/**
 * Delete collections from database
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {Array} collections - List of collections to delete
 * @param {string} postfix - string that was appended to collection name
 * @returns {Promise.<number>} number of deleted collections
 */
async function deleteCollections(stackName, bucketName, collections, postfix) {
  // setProcessEnvironment is not needed by this function, but other code
  // depends on this undocumented side effect
  setProcessEnvironment(stackName, bucketName);

  await Promise.all(
    collections.map(
      ({ name, version }) => {
        const realName = postfix ? `${name}${postfix}` : name;
        return collectionsApi.deleteCollection(stackName, realName, version);
      }
    )
  );

  return collections.length;
}

/**
 * Delete all collections listed from a collections directory
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucket - S3 internal bucket name
 * @param {string} collectionsDirectory - the directory of collection json files
 * @param {string} postfix - string that was appended to collection name
 * @returns {Promise<number>} - number of deleted collections
 */
async function cleanupCollections(stackName, bucket, collectionsDirectory, postfix) {
  // setProcessEnvironment is not needed by this function, but other code
  // depends on this undocumented side effect
  setProcessEnvironment(stackName, bucket);
  const collections = await readJsonFilesFromDir(collectionsDirectory);
  return deleteCollections(stackName, bucket, collections, postfix);
}

/**
 * Get the provider host. If the environment variables are set, set the host
 * according to the variables, otherwise use the original host.
 * This allows us to switch between different environments/accounts, which
 * would hit a different server.
 *
 * @param {Object} provider - provider object
 * @returns {string} provider host
 */
const getProviderHost = ({ host }) => process.env.PROVIDER_HOST || host;

/**
 * Get the provider port. If the port is not set, leave it not set.
 * Otherwise set it to the environment variable, if set.
 *
 * @param {Object} provider - provider object
 * @returns {number} provider port
 */
function getProviderPort({ protocol, port }) {
  if (protocol === 'ftp') {
    return Number(process.env.PROVIDER_FTP_PORT) || port;
  }

  return Number(process.env.PROVIDER_HTTP_PORT) || port;
}

/**
 * Update a provider with a custom s3Host, and update the id to use a postfix.
 *
 * @param {Object} params
 * @param {Object} params.provider
 * @param {string} params.s3Host
 * @param {string} params.postfix
 * @returns {Object} an updated provider
 */
const buildProvider = (params = {}) => {
  const { provider, s3Host, postfix } = params;

  const updatedProvider = { ...provider };

  updatedProvider.port = getProviderPort(provider);

  if (postfix) updatedProvider.id = `${provider.id}${postfix}`;

  if (provider.protocol === 's3' && s3Host) updatedProvider.host = s3Host;
  else updatedProvider.host = getProviderHost(provider);

  return updatedProvider;
};

/**
 * Load a provider from a JSON file and update it
 *
 * @param {Object} params
 * @param {string} params.filename - the JSON file containing the provider
 * @param {string} params.s3Host
 * @param {string} params.postfix
 * @returns {Object} a provider
 */
const loadProvider = async (params = {}) =>
  readJsonFile(params.filename)
    .then((provider) => buildProvider({ ...params, provider }));

/**
 * add providers to database.
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {string} dataDirectory - the directory of provider json files
 * @param {string} [s3Host] - bucket name to be used as the provider host for
 * S3 providers. This will override the host from the seed data. Defaults to null,
 * meaning no override.
 * @param {string} [postfix] - string to append to provider id
 * @returns {Promise<number>} number of providers added
 */
async function addProviders(stackName, bucketName, dataDirectory, s3Host, postfix) {
  const providers = await setupSeedData(stackName, bucketName, dataDirectory);

  const completeProviders = providers.map((provider) => {
    let host;
    if (s3Host && provider.protocol === 's3') host = s3Host;
    else host = getProviderHost(provider);

    return {
      ...provider,
      id: postfix ? `${provider.id}${postfix}` : provider.id,
      port: getProviderPort(provider),
      host
    };
  });

  await Promise.all(
    completeProviders.map(async (provider) => {
      await providersApi.deleteProvider(stackName, provider.id);
      await providersApi.createProvider(stackName, provider);
    })
  );

  return completeProviders.length;
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
  deprecate(
    '@cumulus/integration-tests/index.rulesList',
    '1.18.0',
    '@cumulus/integration-tests/index.readJsonFilesFromDir'
  );
  return setupSeedData(stackName, bucketName, dataDirectory);
}

/**
 * Delete providers from database
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {Array} providers - List of providers to delete
 * @param {string} postfix - string that was appended to provider id
 * @returns {Promise<number>} number of deleted providers
 */
async function deleteProviders(stackName, bucketName, providers, postfix) {
  // setProcessEnvironment is not needed by this function, but other code
  // depends on this undocumented side effect
  setProcessEnvironment(stackName, bucketName);

  await Promise.all(
    providers.map(
      ({ id }) => {
        const readId = postfix ? `${id}${postfix}` : id;
        return providersApi.deleteProvider(stackName, readId);
      }
    )
  );

  return providers.length;
}

/**
 * Delete all collections listed from a collections directory
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucket - S3 internal bucket name
 * @param {string} providersDirectory - the directory of collection json files
 * @param {string} postfix - string that was appended to provider id
 * @returns {number} - number of deleted collections
 */
async function cleanupProviders(stackName, bucket, providersDirectory, postfix) {
  // setProcessEnvironment is not needed by this function, but other code
  // depends on this undocumented side effect
  setProcessEnvironment(stackName, bucket);
  const providers = await readJsonFilesFromDir(providersDirectory);
  return deleteProviders(stackName, bucket, providers, postfix);
}

/**
 * add rules to database. Add a suffix to collection, rule, and provider if specified.
 *
 * NOTE: The postfix will be applied BEFORE the overrides, so if you specify a postfix and
 * an override for collection, provider, or rule, the postfix will not be applied to whatever
 * is specified in the override.
 *
 * @param {string} config - Test config used to set environment variables and template rules data
 * @param {string} dataDirectory - the directory of rules json files
 * @param {Object} overrides - override rule fields
 * @param {string} [postfix] - string to append to rule name, collection, and provider
 * @returns {Promise.<Array>} array of Rules added
 */
async function addRulesWithPostfix(config, dataDirectory, overrides, postfix) {
  const { stackName, bucket } = config;
  const rules = await setupSeedData(stackName, bucket, dataDirectory);

  // Rules should be added in serial because, in the case of SNS and Kinesis rule types,
  // they may share an event source mapping and running them in parallel will cause a
  // race condition
  return pMap(
    rules,
    (rule) => {
      if (postfix) {
        rule.name += globalReplace(postfix, '-', '_'); // rule cannot have dashes
        rule.collection.name += postfix;
        rule.provider += postfix;
      }

      rule = Object.assign(rule, overrides);
      const ruleTemplate = Handlebars.compile(JSON.stringify(rule));
      const templatedRule = JSON.parse(ruleTemplate({
        AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
        AWS_REGION: process.env.AWS_REGION,
        ...config
      }));

      const rulesmodel = new RulesModel();
      console.log(`adding rule ${JSON.stringify(templatedRule)}`);
      return rulesmodel.create(templatedRule);
    },
    { concurrency: 1 }
  );
}

/**
 * add rules to database
 *
 * @param {string} config - Test config used to set environment variables and template rules data
 * @param {string} dataDirectory - the directory of rules json files
 * @param {Object} overrides - override rule fields
 * @returns {Promise.<Array>} array of Rules added
 */
function addRules(config, dataDirectory, overrides) {
  return addRulesWithPostfix(config, dataDirectory, overrides);
}

/**
 * deletes a rule by name
 *
 * @param {string} name - name of the rule to delete.
 * @returns {Promise.<dynamodbDocClient.delete>} - superclass delete promise
 */
async function _deleteOneRule(name) {
  const rulesModel = new RulesModel();
  return rulesModel.get({ name }).then((item) => rulesModel.delete(item));
}

/**
 * Remove params added to the rule when it is saved into dynamo
 * and comes back from the db
 *
 * @param {Object} rule - dynamo rule object
 * @returns {Object} - updated rule object that can be compared to the original
 */
function removeRuleAddedParams(rule) {
  const ruleCopy = cloneDeep(rule);
  delete ruleCopy.state;
  delete ruleCopy.createdAt;
  delete ruleCopy.updatedAt;
  delete ruleCopy.timestamp;

  return ruleCopy;
}

/**
 * Confirm whether task was started by rule by checking for rule-specific value in meta.triggerRule
 *
 * @param {Object} taskInput - Cumulus Task input
 * @param {Object} params - Object as { rule: valueToMatch }
 * @returns {boolean} true if triggered by rule, else false
 */
function isWorkflowTriggeredByRule(taskInput, params) {
  return taskInput.meta.triggerRule && taskInput.meta.triggerRule === params.rule;
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
  deprecate('@cumulus/integration-tests/index.rulesList', '1.18.0', '@cumulus/integration-tests/index.readJsonFilesFromDir');
  return setupSeedData(stackName, bucketName, rulesDirectory);
}

/**
 *
 * @param {string} stackName - Cloud formation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {Array} rules - List of rules objects to delete
 * @param {string} postfix - string that was appended to provider id
 * @returns {Promise.<number>} - Number of rules deleted
 */
async function deleteRules(stackName, bucketName, rules, postfix) {
  // setProcessEnvironment is not needed by this function, but other code
  // depends on this undocumented side effect
  setProcessEnvironment(stackName, bucketName);

  process.env.RulesTable = `${stackName}-RulesTable`;

  await pMap(
    rules,
    (rule) => _deleteOneRule(postfix ? `${rule.name}${postfix}` : rule.name),
    { concurrency: process.env.CONCURRENCY || 3 }
  );

  return rules.length;
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
  const template = await getWorkflowTemplate(stackName, bucketName);

  if (collection) {
    template.meta.collection = await collectionsApi.getCollection(
      stackName,
      collection.name,
      collection.version
    );
  } else {
    template.meta.collection = {};
  }

  if (provider) {
    const providersModel = new ProvidersModel();
    template.meta.provider = await providersModel.get({ id: provider.id });
  } else {
    template.meta.provider = {};
  }

  template.meta.workflow_name = workflowName;
  template.meta = merge(template.meta, meta);
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

/**
 * returns the most recently executed workflows for the specified state machine.
 *
 * @param {string} workflowArn - name of the workflow to get executions for
 * @param {number} maxExecutionResults - max results to return
 * @returns {Array<Object>} array of state function executions.
 */
async function getExecutions(workflowArn, maxExecutionResults = 10) {
  const data = await StepFunctions.listExecutions({
    stateMachineArn: workflowArn,
    maxResults: maxExecutionResults
  });
  return (orderBy(data.executions, ['startDate'], ['desc']));
}

/**
 * Wait for the execution that matches the criteria in the compare function to begin
 * The compare function should take 2 arguments: taskInput and params
 *
 * @param {Object} options
 * @param {string} options.workflowName - workflow name to find execution for
 * @param {string} options.stackName - stack name
 * @param {string} options.bucket - bucket name
 * @param {function} options.findExecutionFn - function that takes the taskInput and
 * findExecutionFnParams and returns a boolean indicating whether or not this is the correct
 * instance of the workflow
 * @param {Object} options.findExecutionFnParams - params to be passed into findExecutionFn
 * @param {string} options.startTask - Name of task to check for step input. Input to this
 * task will be evaluated by the compare function `findExecutionFn`.
 * @param {number} [options.maxWaitSeconds] - an optional custom wait time in seconds
 * @returns {undefined} - none
 * @throws {Error} if workflow was never started
 */
async function waitForTestExecutionStart({
  workflowName,
  stackName,
  bucket,
  findExecutionFn,
  findExecutionFnParams,
  startTask,
  maxWaitSeconds = maxWaitForStartedExecutionSecs
}) {
  let timeWaitedSecs = 0;
  const workflowArn = await getWorkflowArn(stackName, bucket, workflowName);
  /* eslint-disable no-await-in-loop */
  while (timeWaitedSecs < maxWaitSeconds) {
    await sleep(waitPeriodMs);
    timeWaitedSecs += (waitPeriodMs / 1000);
    const executions = await getExecutions(workflowArn);

    for (let executionCtr = 0; executionCtr < executions.length; executionCtr += 1) {
      const execution = executions[executionCtr];
      let taskInput = await lambdaStep.getStepInput(execution.executionArn, startTask);
      if (taskInput) {
        taskInput = await StepFunctions.pullStepFunctionEvent(taskInput);
      }
      if (taskInput && findExecutionFn(taskInput, findExecutionFnParams)) {
        return execution;
      }
    }
  }
  /* eslint-enable no-await-in-loop */
  throw new Error('Never found started workflow.');
}

/**
 * Deep compares two payloads to ensure payload contains all expected values
 * Payload may or may not contain additional values that we don't care about.
 *
 * @param {Object} payload - actual payload
 * @param {Object} expectedPayload - expected payload
 * @returns {boolean} whether payloads are equal
 */
const payloadContainsExpected = (payload, expectedPayload) => {
  let outcome = true;
  Object.keys(expectedPayload).forEach((key) => {
    if (!isEqual(payload[key], expectedPayload[key])) {
      outcome = false;
    }
  });
  return outcome;
};

/**
 * Wait for a certain number of test stepfunction executions to exist.
 *
 * @param {Object} expectedPayload - expected payload for execution
 * @param {string} workflowArn - name of the workflow to wait for
 * @param {integer} maxWaitTimeSecs - maximum time to wait for the correct execution in seconds
 * @param {integer} numExecutions - The number of executions to wait for
 * used to query if the workflow has started.
 * @returns {Array<Object>} [{executionArn: <arn>, status: <status>}]
 * @throws {Error} any AWS error, re-thrown from AWS execution or 'Workflow Never Started'.
 */
async function waitForAllTestSf(
  expectedPayload,
  workflowArn,
  maxWaitTimeSecs,
  numExecutions
) {
  let timeWaitedSecs = 0;
  const workflowExecutions = [];
  const startTime = moment();

  /* eslint-disable no-await-in-loop */
  while (timeWaitedSecs < maxWaitTimeSecs && workflowExecutions.length < numExecutions) {
    await sleep(waitPeriodMs);
    timeWaitedSecs = (moment.duration(moment().diff(startTime)).asSeconds());
    const executions = await getExecutions(workflowArn, 100);
    // Search all recent executions for target payload
    for (let ctr = 0; ctr < executions.length; ctr += 1) {
      const execution = executions[ctr];
      if (!workflowExecutions.find((e) => e.executionArn === execution.executionArn)) {
        const executionInput = await getExecutionInputObject(execution.executionArn);
        if (executionInput !== null
          && payloadContainsExpected(executionInput.payload, expectedPayload)) {
          workflowExecutions.push(execution);
          if (workflowExecutions.length === numExecutions) {
            break;
          }
        }
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  if (workflowExecutions.length > 0) return workflowExecutions;
  throw new Error('Never found started workflow.');
}

module.exports = {
  api,
  rulesApi,
  granulesApi,
  emsApi,
  executionsApi,
  distributionApi,
  EarthdataLogin,
  buildWorkflow,
  testWorkflow,
  executeWorkflow,
  buildAndExecuteWorkflow,
  buildAndStartWorkflow,
  waitForAllTestSf,
  waitForCompletedExecution,
  waitForTestExecutionStart,
  ActivityStep,
  LambdaStep,
  addCollections,
  addCustomUrlPathToCollectionFiles,
  listCollections,
  deleteCollections,
  cleanupCollections,
  addProviders,
  listProviders,
  deleteProviders,
  cleanupProviders,
  conceptExists: cmr.conceptExists,
  getOnlineResources: cmr.getOnlineResources,
  generateCmrFilesForGranules: cmr.generateCmrFilesForGranules,
  generateCmrXml: cmr.generateCmrXml,
  addRules,
  addRulesWithPostfix,
  deleteRules,
  removeRuleAddedParams,
  isWorkflowTriggeredByRule,
  getClusterArn,
  rulesList,
  waitForAsyncOperationStatus,
  getLambdaVersions: lambda.getLambdaVersions,
  getLambdaAliases: lambda.getLambdaAliases,
  getEventSourceMapping: lambda.getEventSourceMapping,
  waitForConceptExistsOutcome: cmr.waitForConceptExistsOutcome,
  getExecutions,
  waitForDeploymentHandler: waitForDeployment.handler,
  getProviderHost,
  getProviderPort,
  loadCollection,
  loadProvider,
  getExecutionOutput,
  readJsonFilesFromDir,
  setProcessEnvironment
};
