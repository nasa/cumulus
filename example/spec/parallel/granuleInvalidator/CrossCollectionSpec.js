const { v4: uuidv4 } = require('uuid');

const {
  createGranule,
  getGranule,
} = require('@cumulus/api-client/granules');

const { invokeApi } = require('@cumulus/api-client');
const { createCollection } = require('@cumulus/api-client/collections');
const { CumulusApiClientError } = require('@cumulus/api-client/CumulusApiClientError');
const { loadConfig } = require('../../helpers/testUtils');
const { removeCollectionAndAllDependencies } = require('../../helpers/Collections');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

const invokeApiNoRetry = (params) => invokeApi({
  ...params,
  pRetryOptions: { retries: 0 },
});

describe('The granule-invalidator deployed within a Cumulus workflow', () => {
  let workflowExecution;
  let config;
  let collectionName;
  let collectionRefName;
  let collectionVersion;
  let collectionId;
  let collectionRefId;
  let rolledOffGranuleId1;
  let rolledOffGranuleId2;
  let rolledOffGranuleRefId1;
  let rolledOffGranuleRefId2;
  let retainedGranuleId1;
  let retainedGranuleId2;

  beforeAll(async () => {
    config = await loadConfig();

    // This postfix is a random string to assure unique collection names
    const randomPostfix = uuidv4().slice(0, 8);
    collectionName = `test-collection-${randomPostfix}`;
    // This collection will be used as the collection to compare granules against for
    // cross-collection invalidation
    collectionRefName = `test-collection-ref-${randomPostfix}`;
    collectionVersion = '001';
    collectionId = `${collectionName}___${collectionVersion}`;
    collectionRefId = `${collectionRefName}___${collectionVersion}`;
    rolledOffGranuleId1 = `rolloff-1-${randomPostfix}`;
    rolledOffGranuleId2 = `rolloff-2-${randomPostfix}`;
    rolledOffGranuleRefId1 = `rolloff-ref-1-${randomPostfix}`;
    rolledOffGranuleRefId2 = `rolloff-ref-2-${randomPostfix}`;
    retainedGranuleId1 = `retain-1-${randomPostfix}`;
    retainedGranuleId2 = `retain-2-${randomPostfix}`;

    const beginningDateTimeToBeRolledOff = '2026-01-29T00:00:00.000Z';
    const endDateTimeToBeRolledOff = '2026-01-30T00:00:00.000Z';

    const granuleOverrides = [
      {
        collectionId: collectionId,
        granuleId: rolledOffGranuleId1,
        producerGranuleId: rolledOffGranuleId1,
      },
      {
        collectionId: collectionId,
        granuleId: rolledOffGranuleId2,
        producerGranuleId: rolledOffGranuleId2,
      },
      {
        collectionId: collectionRefId,
        granuleId: rolledOffGranuleRefId1,
        producerGranuleId: rolledOffGranuleRefId1,
      },
      {
        collectionId: collectionRefId,
        granuleId: rolledOffGranuleRefId2,
        producerGranuleId: rolledOffGranuleRefId2,
      },
      {
        collectionId: collectionId,
        granuleId: retainedGranuleId1,
        producerGranuleId: retainedGranuleId1,
        // This end date just guarantees it will _not_ match endDateTimeToBeRolledOff and it should
        // not be rolled off
        endingDateTime: new Date(
          Date.parse(endDateTimeToBeRolledOff) + 30 * 60 * 1000
        ).toISOString(),
      },
      {
        collectionId: collectionId,
        granuleId: retainedGranuleId2,
        producerGranuleId: retainedGranuleId2,
        // This begin date just guarantees it will _not_ match beginningDateTimeToBeRolledOff and
        // it should not be rolled off
        beginningDateTime: new Date(
          Date.parse(beginningDateTimeToBeRolledOff) + 30 * 60 * 1000
        ).toISOString(),
      },
    ];

    const collectionConfig = {
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
      collection: {
        ...collectionConfig,
        name: collectionName,
        meta: {
          granule_invalidations: [
            {
              type: 'cross_collection',
              invalidating_collection: collectionRefName,
              invalidating_version: '001',
            },
          ],
        },
      },
    });

    await createCollection({ prefix: config.stackName,
      collection: { ...collectionConfig, name: collectionRefName },
    });

    await Promise.all(granuleOverrides.map((granuleOverrideInfo) =>
      createGranule({ prefix: config.stackName,
        body: {
          status: 'completed',
          beginningDateTime: beginningDateTimeToBeRolledOff,
          endingDateTime: endDateTimeToBeRolledOff,
          lastUpdateDateTime: '',
          productionDateTime: '',
          ...granuleOverrideInfo,
        },
      })));

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

  it('crossCollection rolloff configuration is honored', async () => {
    await expectAsync(getGranule(
      {
        prefix: config.stackName,
        granuleId: rolledOffGranuleId1,
        collectionId: collectionId,
        callback: invokeApiNoRetry,
      }
    )).toBeRejectedWithError(CumulusApiClientError, /404/);

    await expectAsync(getGranule(
      {
        prefix: config.stackName,
        granuleId: rolledOffGranuleId2,
        collectionId: collectionId,
        callback: invokeApiNoRetry,
      }
    )).toBeRejectedWithError(CumulusApiClientError, /404/);

    const retainedGranule1 = await getGranule(
      {
        prefix: config.stackName,
        granuleId: retainedGranuleId1,
        collectionId: collectionId,
      }
    );
    expect(retainedGranule1.status).toEqual('completed');

    const retainedGranule2 = await getGranule(
      {
        prefix: config.stackName,
        granuleId: retainedGranuleId2,
        collectionId: collectionId,
      }
    );
    expect(retainedGranule2.status).toEqual('completed');
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
        name: collectionRefName,
        version: collectionVersion,
      },
    });
  });
});
