const { v4: uuidv4 } = require('uuid');

const {
  createGranule,
  getGranule,
} = require('@cumulus/api-client/granules');

const {
  updateCollection,
} = require('@cumulus/api-client/collections');

const { createCollection } = require('@cumulus/api-client/collections');
const { CumulusApiClientError } = require('@cumulus/api-client/CumulusApiClientError');
const { invokeApiNoRetry } = require('../../helpers/apiUtils');
const { loadConfig } = require('../../helpers/testUtils');
const { removeCollectionAndAllDependencies } = require('../../helpers/Collections');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The granule-invalidator deployed within a Cumulus workflow', () => {
  let workflowExecution;
  let config;
  let collectionName;
  let collectionVersion;
  let scienceDateBeforeCutoffId;
  let scienceDateAfterCutoffId;
  let collectionId;

  beforeAll(async () => {
    config = await loadConfig();

    // This postfix is a random string to assure unique collection names
    const randomPostfix = uuidv4().slice(0, 8);
    collectionName = `test-collection-${randomPostfix}`;
    collectionVersion = '001';
    collectionId = `${collectionName}___${collectionVersion}`;
    scienceDateBeforeCutoffId = `before-created-at-cutoff-${randomPostfix}`;
    scienceDateAfterCutoffId = `after-created-at-cutoff-${randomPostfix}`;

    const collectionConfig = {
      name: collectionName,
      version: collectionVersion,
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
    };

    await createCollection({ prefix: config.stackName,
      collection: collectionConfig,
    });

    const cutoffDate = '2026-01-29T00:00:00.000Z';
    const cutoffMinutesOld = Math.floor((Date.now() - Date.parse(cutoffDate)) / (60 * 1000));
    const afterCutoffDate = new Date(Date.parse(cutoffDate) + 24 * 60 * 60 * 1000).toISOString();
    const beforeCutoffDate = new Date(Date.parse(cutoffDate) - 24 * 60 * 60 * 1000).toISOString();

    // Register granules that are on either side of a date threshold based on productionDateTime
    await createGranule({ prefix: config.stackName,
      body: {
        granuleId: scienceDateAfterCutoffId,
        producerGranuleId: scienceDateAfterCutoffId,
        collectionId: collectionId,
        status: 'completed',
        productionDateTime: afterCutoffDate,

        // In order to have `productionDateTime` get written to the granule,
        // these other fields must accompany it (although they don't have to be set to a
        // valid date)
        beginningDateTime: '',
        endingDateTime: '',
        lastUpdateDateTime: '',
      },
    });

    await createGranule({ prefix: config.stackName,
      body: {
        granuleId: scienceDateBeforeCutoffId,
        producerGranuleId: scienceDateBeforeCutoffId,
        collectionId: collectionId,
        status: 'completed',
        productionDateTime: beforeCutoffDate,

        // In order to have `productionDateTime` get written to the granule,
        // these other fields must accompany it (although they don't have to be set to a
        // valid date)
        beginningDateTime: '',
        endingDateTime: '',
        lastUpdateDateTime: '',
      },
    });

    const rolloffConfiguration = {
      granule_invalidations: [
        {
          type: 'science_date',
          maximum_minutes_old: cutoffMinutesOld,
        },
      ],
    };

    collectionConfig.meta = rolloffConfiguration;

    await updateCollection({
      prefix: config.stackName,
      collection: collectionConfig,
    });

    const workflowName = 'GranuleInvalidatorWorkflow';

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      {
        name: collectionName,
        version: collectionVersion,
      },
      config.provider,
      config.payload
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('completed');
  });

  it('scienceDate rolloff configuration is honored', async () => {
    await expectAsync(getGranule(
      {
        prefix: config.stackName,
        granuleId: scienceDateBeforeCutoffId,
        collectionId: collectionId,
        callback: invokeApiNoRetry,
      }
    )).toBeRejectedWithError(CumulusApiClientError, /404/);

    const afterscienceDateTimeCutoffGranule = await getGranule(
      {
        prefix: config.stackName,
        granuleId: scienceDateAfterCutoffId,
        collectionId: collectionId,
      }
    );
    expect(afterscienceDateTimeCutoffGranule.status).toEqual('completed');
  });

  afterAll(async () => {
    await removeCollectionAndAllDependencies({
      prefix: config.stackName,
      collection: {
        name: collectionName,
        version: collectionVersion,
      },
    });
  });
});
