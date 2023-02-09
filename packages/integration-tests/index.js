/* eslint no-param-reassign: "off" */

'use strict';

const delay = require('delay');
const replace = require('lodash/replace');
const orderBy = require('lodash/orderBy');
const cloneDeep = require('lodash/cloneDeep');
const isEqual = require('lodash/isEqual');
const Handlebars = require('handlebars');
const pRetry = require('p-retry');
const pWaitFor = require('p-wait-for');
const pMap = require('p-map');
const moment = require('moment');

const {
  ecs,
} = require('@cumulus/aws-client/services');
const { getJsonS3Object, listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const {
  getWorkflowFileKey,
} = require('@cumulus/common/workflows');
const { readJsonFile } = require('@cumulus/common/FileUtils');
const collectionsApi = require('@cumulus/api-client/collections');
const providersApi = require('@cumulus/api-client/providers');
const rulesApi = require('@cumulus/api-client/rules');
const asyncOperationsApi = require('@cumulus/api-client/asyncOperations');
const { pullStepFunctionEvent } = require('@cumulus/message/StepFunctions');
const { getRequiredEnvVar } = require('@cumulus/common/env.js');

const { addCollections, addCustomUrlPathToCollectionFiles, buildCollection } = require('./Collections.js');
const executionsApi = require('./api/executions');
const granulesApi = require('./api/granules');
const api = require('./api/api');

const EarthdataLogin = require('./api/EarthdataLogin');
const distributionApi = require('./api/distribution');
const cmr = require('./cmr.js');
const lambda = require('./lambda');
const waitForDeployment = require('./lambdas/waitForDeployment');
const { ActivityStep, LambdaStep } = require('./sfnStep');
const { setProcessEnvironment, readJsonFilesFromDir } = require('./utils');

const waitPeriodMs = 1000;
const maxWaitForStartedExecutionSecs = 60 * 5;
const lambdaStep = new LambdaStep();

/**
 * Wait for an AsyncOperation to reach a given status
 *
 * Retries using exponental backoff until desired has been reached.  If the
 *   desired state is not reached an error is thrown.
 *
 * @param {Object} params - params
 * @param {string} params.id - the id of the AsyncOperation
 * @param {string} params.status - the status to wait for
 * @param {string} params.stackName - the Cumulus stack name
 * @param {number} params.retryOptions - retrying options.
 *                   The Default values result in 15 attempts in ~1 min.
 *                   https://github.com/tim-kos/node-retry#retryoperationoptions
 * @returns {Promise<Object>} - the AsyncOperation object
 */
async function waitForAsyncOperationStatus({
  id,
  status,
  stackName,
  retryOptions = {
    retries: 15,
    factor: 1.178,
    minTimeout: 1000,
    maxTimeout: 1000 * 60 * 5,
  },
}) {
  let operation;
  return await pRetry(
    async () => {
      operation = await asyncOperationsApi.getAsyncOperation({
        prefix: stackName,
        asyncOperationId: id,
      });

      if (operation.status === status) return operation;
      throw new Error(`AsyncOperationStatus on ${JSON.stringify(operation)} Never Reached desired state ${status}.`);
    },
    {
      onFailedAttempt: (error) => console.log(`Waiting for AsyncOperation status ${operation.status} to reach ${status}. ${error.attemptsLeft} retries remain.`),
      ...retryOptions,
    }
  );
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
    .then(pullStepFunctionEvent);

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
  } catch (error) {
    if (error.code === 'ExecutionDoesNotExist') return 'STARTING';
    throw error;
  }
}

/**
 * Wait for a given execution to start
 *
 * @param {string} executionArn - ARN of the execution
 * @param {number} [timeout=600] - the time, in seconds, to wait for the
 *   execution to reach a terminal state
 * @returns {string} status
 */
async function waitForStartedExecution(executionArn, timeout = 600) {
  await pWaitFor(
    async () => {
      const status = await getExecutionStatus(executionArn);
      return status !== 'STARTING';
    },
    {
      interval: 2000,
      timeout: timeout * 1000,
    }
  );
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
      timeout: timeout * 1000,
    }
  );

  return status;
}

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
  await readJsonFile(params.filename)
    .then((collection) => buildCollection({ ...params, collection }));

/**
 * Delete collections from database
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucketName - S3 internal bucket name
 * @param {Array} collections - List of collections to delete
 * @param {string} postfix - string that was appended to collection name
 * @returns {Array<Object>} a list of the http responses
 */
async function deleteCollections(stackName, bucketName, collections, postfix) {
  // setProcessEnvironment is not needed by this function, but other code
  // depends on this undocumented side effect
  setProcessEnvironment(stackName, bucketName);

  return await Promise.all(
    collections.map(
      ({ name, version }) => {
        const realName = postfix ? `${name}${postfix}` : name;
        return collectionsApi.deleteCollection({
          prefix: stackName,
          collectionName: realName,
          collectionVersion: version,
        });
      }
    )
  );
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
  await readJsonFile(params.filename)
    .then((provider) => buildProvider({ ...params, provider }));

/**
 *  Returns true if provider exists, false otherwise
 * @param {string} stackName
 * @param {string} id
 * @returns {boolean}
 */
const providerExists = async (stackName, id) => {
  let response;
  const exists = await pRetry(
    async () => {
      try {
        response = await providersApi.getProvider({
          prefix: stackName,
          providerId: id,
          pRetryOptions: {
            retries: 0,
          },
        });
      } catch (error) {
        if (error.statusCode === 404) {
          console.log(`Error: ${error}. Failed to get provider with ID ${id}`);
          return false;
        }
        throw error;
      }
      if (response.statusCode === 200) return true;
      return false;
    },
    { retries: 5, minTimeout: 2000, maxTimeout: 2000 }
  );
  return exists;
};

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
      host,
    };
  });

  await Promise.all(
    completeProviders.map(async (provider) => {
      if (await providerExists(stackName, provider.id)) {
        await providersApi.deleteProvider({ prefix: stackName, providerId: provider.id });
      }
      await providersApi.createProvider({
        prefix: stackName,
        provider: provider,
      });
    })
  );

  return completeProviders.length;
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
        return providersApi.deleteProvider({ prefix: stackName, providerId: readId });
      }
    )
  );

  return providers.length;
}

/**
 * Delete all providers listed from a providers directory
 *
 * @param {string} stackName - CloudFormation stack name
 * @param {string} bucket - S3 internal bucket name
 * @param {string} providersDirectory - the directory of providers json files
 * @param {string} postfix - string that was appended to provider id
 * @returns {number} - number of deleted providers
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
  return await pMap(
    rules,
    async (rule) => {
      if (postfix) {
        rule.name += replace(postfix, /-/g, '_');
        rule.collection.name += postfix;
        rule.provider += postfix;
      }

      rule = Object.assign(rule, overrides);
      const ruleTemplate = Handlebars.compile(JSON.stringify(rule));
      const templatedRule = JSON.parse(ruleTemplate({
        AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
        AWS_REGION: process.env.AWS_REGION,
        ...config,
      }));

      console.log(`adding rule ${JSON.stringify(templatedRule)}`);

      const response = await rulesApi.postRule({
        prefix: stackName,
        rule: templatedRule,
      });
      const { record } = JSON.parse(response.body);
      return record;
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

  await pMap(
    rules,
    (rule) => rulesApi.deleteRule({
      prefix: stackName,
      ruleName: postfix ? `${rule.name}${postfix}` : rule.name,
    }),
    { concurrency: process.env.CONCURRENCY || 3 }
  );

  return rules.length;
}

/**
 * Delete a rule's Kinesis Event Source Mappings
 *
 * @param {Object} rule - a Rule record as returned by the Rules api
 * @param {string} rule.name
 * @param {Object} rule.rule
 * @param {string} rule.rule.arn
 * @param {string} rule.rule.logEventArn
 * @returns {Promise<Object>[]} - Event Source Map deletion results
 */
async function deleteRuleResources(rule) {
  const kinesisSourceEvents = [
    {
      name: getRequiredEnvVar(process.env.messageConsumer),
      eventType: 'arn',
      type: {
        arn: rule.rule.arn,
      },
    },
    {
      name: getRequiredEnvVar(process.env.KinesisInboundEventLogger),
      eventType: 'log_event_arn',
      type: {
        log_event_arn: rule.rule.logEventArn,
      },
    },
  ];
  const deleteEventPromises = kinesisSourceEvents.map(
    (kinesisEvent) => lambda.deleteEventSourceMapping(
      kinesisEvent.type[kinesisEvent.eventType]
    ).catch(
      (error) => {
        console.log(`Error deleting eventSourceMapping for ${rule.name}: ${error}`);
        if (error.code !== 'ResourceNotFoundException') throw error;
      }
    )
  );
  return await Promise.all(deleteEventPromises);
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
    maxResults: maxExecutionResults,
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
  maxWaitSeconds = maxWaitForStartedExecutionSecs,
}) {
  let timeWaitedSecs = 0;
  const { arn: workflowArn } = await getJsonS3Object(
    bucket,
    getWorkflowFileKey(stackName, workflowName)
  );
  /* eslint-disable no-await-in-loop */
  while (timeWaitedSecs < maxWaitSeconds) {
    await delay(waitPeriodMs);
    timeWaitedSecs += (waitPeriodMs / 1000);
    const executions = await getExecutions(workflowArn);

    for (let executionCtr = 0; executionCtr < executions.length; executionCtr += 1) {
      const execution = executions[executionCtr];
      let taskInput = await lambdaStep.getStepInput(execution.executionArn, startTask);
      if (taskInput) {
        taskInput = await pullStepFunctionEvent(taskInput);
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

  console.log('expectedPayload', expectedPayload);

  /* eslint-disable no-await-in-loop */
  while (timeWaitedSecs < maxWaitTimeSecs && workflowExecutions.length < numExecutions) {
    await delay(waitPeriodMs);
    timeWaitedSecs = (moment.duration(moment().diff(startTime)).asSeconds());
    const sfExecutions = await getExecutions(workflowArn, 100);
    const executions = sfExecutions.filter(
      (sfExecution) => sfExecution.startDate.getTime() > Date.now() - 12 * 3600 * 1000
    );
    // Search all recent 12 hours executions for target payload
    for (let ctr = 0; ctr < executions.length; ctr += 1) {
      const execution = executions[ctr];
      if (!workflowExecutions.find((e) => e.executionArn === execution.executionArn)) {
        const executionInput = await getExecutionInputObject(execution.executionArn);
        if (executionInput === null) {
          console.log(`no execution input for ARN ${execution.executionArn}`);
        }
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

/**
 * Wait for listObjectsV2 to return the expected result count for a given bucket & prefix.
 *
 * @param {Object} params - params object
 * @param {string} params.bucket - S3 bucket
 * @param {string} [params.prefix] - S3 prefix
 * @param {number} params.desiredCount - Desired count to wait for
 * @param {number} [params.interval] - pWaitFor retry interval, in ms
 * @param {number} [params.timeout] - pWaitFor timeout, in ms
 * @returns {Promise<undefined>}
 */
async function waitForListObjectsV2ResultCount({
  bucket,
  prefix = '',
  desiredCount,
  interval = 1000,
  timeout = 30 * 1000,
}) {
  await pWaitFor(
    async () => {
      const results = await listS3ObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
      });
      return results.length === desiredCount;
    },
    { interval, timeout }
  );
}

module.exports = {
  ActivityStep,
  addCollections,
  addCustomUrlPathToCollectionFiles,
  addProviders,
  addRules,
  addRulesWithPostfix,
  api,
  buildCollection,
  cleanupCollections,
  cleanupProviders,
  conceptExists: cmr.conceptExists,
  deleteCollections,
  deleteProviders,
  deleteRules,
  deleteRuleResources,
  distributionApi,
  EarthdataLogin,
  executionsApi,
  generateCmrFilesForGranules: cmr.generateCmrFilesForGranules,
  generateCmrXml: cmr.generateCmrXml,
  getClusterArn,
  getEventSourceMapping: lambda.getEventSourceMapping,
  getExecutionOutput,
  getExecutions,
  getExecutionInputObject,
  getLambdaAliases: lambda.getLambdaAliases,
  getLambdaVersions: lambda.getLambdaVersions,
  getOnlineResources: cmr.getOnlineResources,
  getProviderHost,
  getProviderPort,
  granulesApi,
  isWorkflowTriggeredByRule,
  LambdaStep,
  loadCollection,
  loadProvider,
  readJsonFilesFromDir,
  removeRuleAddedParams,
  rulesApi,
  setProcessEnvironment,
  waitForAllTestSf,
  waitForAsyncOperationStatus,
  waitForCompletedExecution,
  waitForStartedExecution,
  waitForConceptExistsOutcome: cmr.waitForConceptExistsOutcome,
  waitForDeploymentHandler: waitForDeployment.handler,
  waitForListObjectsV2ResultCount,
  waitForTestExecutionStart,
};
