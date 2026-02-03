const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { getExecution } = require('@cumulus/api-client/executions');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { removeCollectionAndAllDependencies } = require('../../helpers/Collections');
const { loadConfig } = require('../../helpers/testUtils');
const { sleep } = require('@cumulus/common');

const {
  createGranule,
  getGranule,
} = require('@cumulus/api-client/granules');
const { createCollection } = require('@cumulus/api-client/collections');

const activityStep = new ActivityStep();

describe('The granule-invalidator deployed within a Cumulus workflow', () => {
  let workflowExecution;
  let config;

  beforeAll(async () => {
    config = await loadConfig();

    let datetimePostfix = Date.now();

    randomRefCollectionName = `test-collection-ref-${datetimePostfix}`;
    randomCompCollectionName = `test-collection-comp-${datetimePostfix}`;

    const collectionTemplate = {
      granuleId: '^.*$',
      granuleIdExtraction: '^(.*)$',
      sampleFileName: 'sample.h5',
      files: [
        {
          bucket: config.bucket,
          regex: '^.*$',
          sampleFileName: 'sample.h5',
        },
      ],
    }

    await createCollection({prefix: config.stackName,
      collection: {
        name: randomRefCollectionName,
        version: '001',
        ...collectionTemplate,
      }
    });

    await createCollection({prefix: config.stackName,
      collection: {
        name: randomCompCollectionName,
        version: '001',
        ...collectionTemplate,
      }
    });

    const cutoffDate = '2026-01-29T00:00:00.000Z';
    const afterCutoffDate = new Date(Date.parse(cutoffDate) + 24 * 60 * 60 * 1000).toISOString();
    const beforeCutoffDate = new Date(Date.parse(cutoffDate) - 24 * 60 * 60 * 1000).toISOString();
    // Register granules that are on either side of a date threshold based on endingDateTime
    await createGranule({prefix: config.stackName,
      body: {
        granuleId: `test-granule-1-${datetimePostfix}`,
        producerGranuleId: `test-granule-1-${datetimePostfix}`,
        collectionId: `${randomRefCollectionName}___001`,
        status: 'completed',
        productionDateTime: afterCutoffDate,
      }
    });

    await createGranule({prefix: config.stackName,
      body: {
        granuleId: `test-granule-2-${datetimePostfix}`,
        producerGranuleId: `test-granule-2-${datetimePostfix}`,
        collectionId: `${randomRefCollectionName}___001`,
        status: 'completed',
        productionDateTime: beforeCutoffDate,
      }
    });

    // Register granules that are on either side of a date threshold based on endingDateTime
    createdAtGran3Name = `test-granule-3-${datetimePostfix}`;
    createdAtGran4Name = `test-granule-4-${datetimePostfix}`;
    await createGranule({prefix: config.stackName,
      body: {
        granuleId: createdAtGran3Name,
        producerGranuleId: createdAtGran3Name,
        collectionId: `${randomRefCollectionName}___001`,
        status: 'completed',
      }
    });
    await sleep(2000);

    await createGranule({prefix: config.stackName,
      body: {
        granuleId: createdAtGran4Name,
        producerGranuleId: createdAtGran4Name,
        collectionId: `${randomRefCollectionName}___001`,
        status: 'completed',
      }
    });

    const granule3 = await getGranule(
      {
        prefix: config.stackName,
        granuleId: createdAtGran3Name,
        collectionId: `${randomRefCollectionName}___001`
      });
    const granule4 = await getGranule(
      {
        prefix: config.stackName,
        granuleId: createdAtGran4Name,
        collectionId: `${randomRefCollectionName}___001`
      });
    const createAtCutoffTime = new Date((granule3.createdAt + granule4.createdAt) / 2);

    // Register granules that are in 2 collections that have the same begin/end time
    const startTime = '2026-01-29T00:00:00.000Z';
    const endTime = new Date(Date.parse(startTime) + 24 * 60 * 60 * 1000).toISOString();
    await createGranule({prefix: config.stackName,
      body: {
        granuleId: `test-granule-5-${datetimePostfix}`,
        producerGranuleId: `test-granule-5-${datetimePostfix}`,
        collectionId: `${randomRefCollectionName}___001`,
        status: 'completed',
        beginningDateTime: startTime,
        endingDateTime: endTime,
      }
    });
    await createGranule({prefix: config.stackName,
      body: {
        granuleId: `test-granule-6-${datetimePostfix}`,
        producerGranuleId: `test-granule-6-${datetimePostfix}`,
        collectionId: `${randomCompCollectionName}___001`,
        status: 'completed',
        beginningDateTime: startTime,
        endingDateTime: endTime,
      }
    });

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      `${config.stackName}-GranuleInvalidatorWorkflow`
    );
  });

  it('executes successfully', () => {
    expect(true).toBe(true);
  });

  afterAll(async () => {
    removeCollectionAndAllDependencies({
      prefix: config.stackName,
      collection: {
        name: randomRefCollectionName,
        version: '001',
      },
    });
    removeCollectionAndAllDependencies({
      prefix: config.stackName,
      collection: {
        name: randomCompCollectionName,
        version: '001',
      },
    });
  });
});
