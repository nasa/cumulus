const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { getExecution } = require('@cumulus/api-client/executions');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { registerNewGranule } = require('../../helpers/granuleUtils');
const { loadConfig } = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');

const activityStep = new ActivityStep();

describe('The Hello World workflow using ECS and CMA Layers', () => {
  let workflowExecution;
  let config;

  beforeAll(async () => {
    config = await loadConfig();

    const cutoffDate = '2026-01-29T00:00:00.000Z';
    const afterCutoffDate = new Date(Date.parse(cutoffDate) + 24 * 60 * 60 * 1000).toISOString();
    const beforeCutoffDate = new Date(Date.parse(cutoffDate) - 24 * 60 * 60 * 1000).toISOString();
    // Register granules that are on either side of a date threshold based on endingDateTime
    await registerNewGranule(config.stackName, {
      granuleId: 'test-granule-1',
      collectionId: 'test-collection___001',
      status: 'completed',
      productionDateTime: afterCutoffDate,
    });
    await registerNewGranule(config.stackName, {
      granuleId: 'test-granule-2',
      collectionId: 'test-collection___001',
      status: 'completed',
      productionDateTime: beforeCutoffDate,
    });

    // Register granules that are on either side of a date threshold based on endingDateTime
    await registerNewGranule(config.stackName, {
      granuleId: 'test-granule-3',
      collectionId: 'test-collection___001',
      status: 'completed',
      createdAt: afterCutoffDate,
    });
    await registerNewGranule(config.stackName, {
      granuleId: 'test-granule-4',
      collectionId: 'test-collection___001',
      status: 'completed',
      createdAt: beforeCutoffDate,
    });

    // Register granules that are in 2 collections that have the same begin/end time
    const startTime = '2026-01-29T00:00:00.000Z';
    const endTime = new Date(Date.parse(startTime) + 24 * 60 * 60 * 1000).toISOString();
    await registerNewGranule(config.stackName, {
      granuleId: 'test-granule-5',
      collectionId: 'test-collection___002',
      status: 'completed',
      beginningDateTime: startTime,
      endingDateTime: endTime,
    });
    await registerNewGranule(config.stackName, {
      granuleId: 'test-granule-6',
      collectionId: 'test-collection___003',
      status: 'completed',
      beginningDateTime: startTime,
      endingDateTime: endTime,
    });

    //workflowExecution = await buildAndExecuteWorkflow(
    //  config.stackName,
    //  config.bucket,
    //  'GranuleInvalidatorWorkflow'
    //);
  });

  afterAll(async () => {
    //TODO; delete granules
    //await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
  });
});
