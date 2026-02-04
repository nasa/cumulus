const { v4: uuidv4 } = require('uuid');

const {
  createGranule,
  getGranule,
  updateGranule,
} = require('@cumulus/api-client/granules');

const {
  updateCollection,
} = require('@cumulus/api-client/collections');

const { createCollection } = require('@cumulus/api-client/collections');
const { CumulusApiClientError } = require('@cumulus/api-client/CumulusApiClientError');
const { loadConfig } = require('../../helpers/testUtils');
const { removeCollectionAndAllDependencies } = require('../../helpers/Collections');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The granule-invalidator deployed within a Cumulus workflow', () => {
  let workflowExecution;
  let config;
  let collectionName;
  let collectionVersion;
  let ingestDateBeforeCutoffId;
  let ingestDateAfterCutoffId;

  beforeAll(async () => {
    config = await loadConfig();

    // This postfix is a random string to assure unique collection names
    const randomPostfix = uuidv4().slice(0, 8);
    collectionName = `test-collection-${randomPostfix}`;
    collectionVersion = '001';
    ingestDateBeforeCutoffId = `before-created-at-cutoff-${randomPostfix}`;
    ingestDateAfterCutoffId = `after-created-at-cutoff-${randomPostfix}`;

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

    // Register granules that are on either side of a date threshold based on endingDateTime
    await createGranule({ prefix: config.stackName,
      body: {
        granuleId: ingestDateBeforeCutoffId,
        producerGranuleId: ingestDateBeforeCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
        status: 'completed',
      },
    });

    await createGranule({ prefix: config.stackName,
      body: {
        granuleId: ingestDateAfterCutoffId,
        producerGranuleId: ingestDateAfterCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
        status: 'completed',
      },
    });

    const now = Date.now();
    const beforeCutoffMinutesOld = 60;
    const oneHourAgo = new Date(now - beforeCutoffMinutesOld * 60 * 1000).getTime();

    await updateGranule({
      prefix: config.stackName,
      granuleId: ingestDateBeforeCutoffId,
      collectionId: `${collectionName}___${collectionVersion}`,
      body: {
        granuleId: ingestDateBeforeCutoffId,
        producerGranuleId: ingestDateBeforeCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
        createdAt: oneHourAgo,
        status: 'completed',
      },
    });

    await updateGranule({
      prefix: config.stackName,
      granuleId: ingestDateAfterCutoffId,
      collectionId: `${collectionName}___${collectionVersion}`,
      body: {
        granuleId: ingestDateAfterCutoffId,
        producerGranuleId: ingestDateAfterCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
        createdAt: now,
        status: 'completed',
      },
    });

    const rolloffConfiguration = {
      granule_invalidations: [
        {
          type: 'ingest_date',
          maximum_minutes_old: beforeCutoffMinutesOld / 2,
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

  it('ingestDateDateTime rolloff configuration is honored', async () => {
    await expectAsync(getGranule(
      {
        prefix: config.stackName,
        granuleId: ingestDateBeforeCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
      }
    )).toBeRejectedWithError(CumulusApiClientError, /404/);

    const afteringestDateDateTimeCutoffGranule = await getGranule(
      {
        prefix: config.stackName,
        granuleId: ingestDateAfterCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
      }
    );
    expect(afteringestDateDateTimeCutoffGranule.status).toEqual('completed');
  });

  afterAll(async () => {
    await removeCollectionAndAllDependencies({
      prefix: config.stackName,
      collection: {
        name: collectionName,
        version: collectionVersion,
      },
    });
    await removeCollectionAndAllDependencies({
      prefix: config.stackName,
      collection: {
        name: collectionName,
        version: collectionVersion,
      },
    });
  });
});
