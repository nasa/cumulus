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

// TODO consider extracting out some of the following code
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

  const resolver = collConfig.ingestStackResourceResolver(
    ingestStackResources, resources.state_machine_prefix);

  const collectionConfig = await collConfig.loadCollectionConfig(stackName, resolver);
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