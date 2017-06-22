'use strict';

/**
 * Allows kicking off reingestion of granules.
 */

/*eslint no-console: ["error", { allow: ["error", "info"] }] */
const { stepFunctions, ecs } = require('./aws');
const { handleError } = require('./api-errors');
const collConfig = require('./collection-config');
const sf = require('ingest-common/step-functions');
const { getIngestStackResources, getPhysicalResourceId } = require('./stack-resources');
const ExecutionIndexer = require('./execution-indexer');
const { parseExecutionName } = require('./execution-name-parser');

/**
 * Fetches the resources associated with the given stack.
 */
const getResources = async (stackName) => {
  const ingestStackResources = await getIngestStackResources(stackName);

  // Get resources
  const schedulerTaskArn = getPhysicalResourceId(ingestStackResources, 'SfnSchedulerTask');
  const taskDef = await ecs().describeTaskDefinition({ taskDefinition: schedulerTaskArn })
    .promise();
  const command = taskDef.taskDefinition.containerDefinitions[0].command;
  const eventJsonIndex = command.findIndex(a => a === '--eventJson');
  const eventJson = command[eventJsonIndex + 1];
  return JSON.parse(eventJson).resources;
};

/**
 * TODO
 * granuleId can be null. Used for indexing with execution tracking
 */
const executeWorkflowForReingest =
async (collectionConfig, resources, collection, granuleFilterFn, granuleId) => {
  const collectionId = collection.get('id');
  const provider = collectionConfig.get('providers')
    .filter(p => p.get('id') === collection.get('provider_id'))
    .first();

  // Create payload for step function execution
  const sfInput = sf.constructStepFunctionInput(resources, provider.toJS(), collection.toJS());
  const stateMachine = collection.get('workflow');

  // Update the step configuration to add in the granule filter.
  // The first step of workflow will have an additional configuration item to detect only the
  // given granuleId.
  const firstStep = collectionConfig.getIn(['workflows', stateMachine, 'StartAt']);
  const granuleFilter = granuleFilterFn(collectionId);
  sfInput.workflow_config_template[firstStep].granule_filter = granuleFilter;

  const executionName = sfInput.ingest_meta.execution_name;
  const { uuid } = parseExecutionName(executionName);

  console.info(`Starting execution of ${stateMachine} for ${JSON.stringify(granuleFilter)}`);
  console.info(`Input ${JSON.stringify(sfInput, null, 2)}`);

  await Promise.all([
    stepFunctions().startExecution({
      stateMachineArn: stateMachine,
      input: JSON.stringify(sfInput),
      name: executionName
    }).promise(),
    ExecutionIndexer.indexReingestExecution({ collectionId, granuleId, executionName, uuid })
  ]);

  return executionName;
};

/**
 * Starts reingesting a granule in the given collection .
 */
const reingestGranule = async (stackName, collectionId, granuleId) => {
  const [resources, collectionConfig] = await Promise.all([
    getResources(stackName),
    collConfig.loadCollectionConfig(stackName)
  ]);

  const collection = collectionConfig.get('collections')
    .filter(c => collectionId === c.get('id'))
    .first();

  const granuleFilterFn = () => ({
    // Fix this assumption as part of GITC-358.
    filtered_granule_keys: [`VIIRS/${collectionId}/${granuleId}`]
  });

  return executeWorkflowForReingest(
    collectionConfig, resources, collection, granuleFilterFn, granuleId);
};

/**
 * handleReingestRequest - Handles the API request to reingest a single granule
 */
const handleReingestGranuleRequest = async (req, res) => {
  try {
    req.checkQuery('stack_name', 'Invalid stack_name').notEmpty();
    req.checkQuery('collection_id', 'Invalid collection_id').notEmpty();
    req.checkQuery('granule_id', 'Invalid granule_id').notEmpty();
    const result = await req.getValidationResult();
    if (!result.isEmpty()) {
      res.status(400).json(result.array());
    }
    else {
      const stackName = req.query.stack_name;
      const collectionId = req.query.collection_id;
      const granuleId = req.query.granule_id;
      res.json(await reingestGranule(stackName, collectionId, granuleId));
    }
  }
  catch (e) {
    console.error(e);
    handleError(e, req, res);
  }
};


/**
 * Returns the day (1- 366) of the year given a date.
 */
const dateToDayOfYear = (d) => {
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0);
  const ms = d.valueOf() - startOfYear;
  return Math.floor(ms / (24 * 3600 * 1000)) + 1;
};

/**
 * TODO
 */
const reingestGranules = async (stackName, collectionIds, startDate, stopDate) => {
  const [resources, collectionConfig] = await Promise.all([
    getResources(stackName),
    collConfig.loadCollectionConfig(stackName)
  ]);

  const collectionIdSet = Set(collectionIds);
  const collections = collectionConfig.get('collections')
    .filter(c => collectionIdSet.has(c.get('id')));

  // TODO if collections length doesn't ==== collectionIds length return error

  const dateToDayOfYearDate = d => `${d.getUTCFullYear()}${dateToDayOfYear(d)}`;

  // GITC-358: Fix this assumption that granule ids are constructed this way.
  const granuleFilterFn = collectionId => ({
    filtered_granule_key_start: `VIIRS/${collectionId}/${dateToDayOfYearDate(startDate)}`,
    filtered_granule_key_end: `VIIRS/${collectionId}/${dateToDayOfYearDate(stopDate)}`
  });

  const executionNamePromises = collections.map(collection =>
    executeWorkflowForReingest(collectionConfig, resources, collection, granuleFilterFn, null));
  return Promise.all(executionNamePromises);
};

/**
 * handleReingestRequest - Handles the API request to reingest multiple granules
 */
const handleReingestGranulesRequest = async (req, res) => {
  try {
    req.checkQuery('stack_name', 'Invalid stack_name').notEmpty();
    req.checkQuery('collection_ids', 'Invalid collection_ids').notEmpty();
    // TODO add dates and validation
    // Just use ms for dates
    req.checkQuery('start_date', 'Invalid start_date').notEmpty();
    req.checkQuery('end_date', 'Invalid end_date').notEmpty();
    const result = await req.getValidationResult();
    if (!result.isEmpty()) {
      res.status(400).json(result.array());
    }
    else {
      const stackName = req.query.stack_name;
      const collectionIds = req.query.collection_ids.split(',');
      const startDate = req.query.start_date;
      const stopDate = req.query.stopDate;
      res.json(await reingestGranules(stackName, collectionIds, startDate, stopDate));
    }
  }
  catch (e) {
    console.error(e);
    handleError(e, req, res);
  }
};

module.exports = {
  handleReingestGranuleRequest,
  handleReingestGranulesRequest,
  // Testing
  dateToDayOfYear
};
