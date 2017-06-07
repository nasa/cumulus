'use strict';

/**
 * TODO
 */

/*eslint no-console: ["error", { allow: ["error", "info"] }] */
const { stepFunctions, ecs } = require('./aws');
const { handleError } = require('./api-errors');
const collConfig = require('./collection-config');
const sf = require('ingest-common/step-functions');
const { getIngestStackResources, getPhysicalResourceId } = require('./stack-resources');

// TODO consider extracting out some of the following code into helper functions
// TODO look for concurrency opportunities when doing that.

/**
 * TODO
 */
const reingestGranule = async (stackName, collectionId, granuleId) => {
  const ingestStackResources = await getIngestStackResources(stackName);

  // Get resources
  const schedulerTaskArn = getPhysicalResourceId(ingestStackResources, 'SfnSchedulerTask');
  const taskDef = await ecs().describeTaskDefinition({ taskDefinition: schedulerTaskArn })
    .promise();
  const command = taskDef.taskDefinition.containerDefinitions[0].command;
  const eventJsonIndex = command.findIndex(a => a === '--eventJson');
  const eventJson = command[eventJsonIndex + 1];
  const resources = JSON.parse(eventJson).resources;

  const collectionConfig = await collConfig.loadCollectionConfig(stackName);
  const collection = collectionConfig.get('collections')
    .filter(c => collectionId === c.get('id'))
    .first();
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
  sfInput.workflow_config_template[firstStep].filtered_granule_keys = [granuleId];

  // TODO consider some sort of signifier that this execution is one for reingesting a specific set
  // of granules.

  const executionName = sfInput.ingest_meta.execution_name;

  console.info(`Starting execution of ${stateMachine} for ${granuleId}`);
  console.info(`Input ${JSON.stringify(sfInput, null, 2)}`);

  await stepFunctions().startExecution({
    stateMachineArn: stateMachine,
    input: JSON.stringify(sfInput),
    name: executionName
  }).promise();
  return executionName;
};

// printPromise(reingestGranule('gitc-jg', 'VNGCR_NQD_C1', 'VIIRS/VNGCR_NQD_C1/2017152'));

/**
 * handleReingestRequest - Handles the API request to reingest granules
 */
const handleReingestRequest = async (req, res) => {
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

module.exports = { handleReingestRequest };
