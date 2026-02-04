const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { getExecution } = require('@cumulus/api-client/executions');

const { buildWorkflow, executeWorkflow} = require('../../helpers/workflowUtils');
const { removeCollectionAndAllDependencies } = require('../../helpers/Collections');
const { loadConfig } = require('../../helpers/testUtils');
const { sleep } = require('@cumulus/common');
const { v4: uuidv4 } = require('uuid');

const {
  createGranule,
  getGranule,
  updateGranule,
} = require('@cumulus/api-client/granules');

const {
  updateCollection
} = require('@cumulus/api-client/collections');

const { createCollection } = require('@cumulus/api-client/collections');
const { CumulusApiClientError } = require('@cumulus/api-client/CumulusApiClientError');

describe('The granule-invalidator deployed within a Cumulus workflow', () => {
  let workflowExecution;
  let config;
  let collectionName;
  let collectionVersion;
  let createdAtBeforeCutoffId;
  let createdAtAfterCutoffId;

  beforeAll(async () => {
    config = await loadConfig();

    // This postfix is a random string to assure unique collection names
    let randomPostfix = uuidv4();
    collectionName = `test-collection-${randomPostfix}`;
    collectionVersion = '001';
    createdAtBeforeCutoffId = `before-created-at-cutoff-${randomPostfix}`;
    createdAtAfterCutoffId = `after-created-at-cutoff-${randomPostfix}`;

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
    }

    await createCollection({prefix: config.stackName,
      collection: collectionConfig
    });

    // Register granules that are on either side of a date threshold based on endingDateTime
    await createGranule({prefix: config.stackName,
      body: {
        granuleId: createdAtBeforeCutoffId,
        producerGranuleId: createdAtBeforeCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
        status: 'completed',
      }
    });

    await createGranule({prefix: config.stackName,
      body: {
        granuleId: createdAtAfterCutoffId,
        producerGranuleId: createdAtAfterCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
        status: 'completed',
      }
    });

    const now = Date.now();
    const beforeCutoffMinutesOld = 60;
    const oneHourAgo = new Date(now - beforeCutoffMinutesOld * 60 * 1000).getTime();

    await updateGranule({
      prefix: config.stackName,
      granuleId: createdAtBeforeCutoffId,
      collectionId: `${collectionName}___${collectionVersion}`,
      body: {
        granuleId: createdAtBeforeCutoffId,
        producerGranuleId: createdAtBeforeCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
        createdAt: oneHourAgo,
        status: 'completed',
      }
    });

    await updateGranule({
      prefix: config.stackName,
      granuleId: createdAtAfterCutoffId,
      collectionId: `${collectionName}___${collectionVersion}`,
      body: {
        granuleId: createdAtAfterCutoffId,
        producerGranuleId: createdAtAfterCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`,
        createdAt: now,
        status: 'completed',
      }
    });

    const rolloffConfiguration = {
      'granule_invalidations': [
        {
          'type': 'ingest_date',
          'maximum_minutes_old': beforeCutoffMinutesOld / 2,
        }
      ]
    }

    collectionConfig.meta = rolloffConfiguration;

    await updateCollection({
      prefix: config.stackName,
      collection: collectionConfig,
    });

    const workflowName = 'Passthrough';

    standardWorkflowMessage = await buildWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      {
        name: collectionName,
        version: collectionVersion,
      },
      config.provider,
      config.payload,
      {}
    );

    invalidationConfiguration = {

    }

    workflowExecution = await executeWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      standardWorkflowMessage
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('completed');
  });

  it('CreatedAtDateTime rolloff configuration is honored', async () => {

    await expectAsync(getGranule(
      {
        prefix: config.stackName,
        granuleId: 'abc',//createdAtBeforeCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`
      }
    )).toBeRejectedWithError(CumulusApiClientError, /404/);

    const afterCreatedAtDateTimeCutoffGranule = await getGranule(
      {
        prefix: config.stackName,
        granuleId: createdAtAfterCutoffId,
        collectionId: `${collectionName}___${collectionVersion}`
      }
    );
    expect(afterCreatedAtDateTimeCutoffGranule.status).toEqual('completed');
  });

  afterAll(async () => {
    removeCollectionAndAllDependencies({
      prefix: config.stackName,
      collection: {
        name: collectionName,
        version: collectionVersion,
      },
    });
    removeCollectionAndAllDependencies({
      prefix: config.stackName,
      collection: {
        name: collectionName,
        version: collectionVersion,
      },
    });
  });
});
