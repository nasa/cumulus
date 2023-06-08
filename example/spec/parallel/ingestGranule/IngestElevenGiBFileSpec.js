'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const pick = require('lodash/pick');
const { randomId } = require('@cumulus/common/test-utils');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const {
  findExecutionArn, getExecutionWithStatus,
} = require('@cumulus/integration-tests/Executions');
const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');

const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');
const { encodedConstructCollectionId } = require('../../helpers/Collections');
const { loadConfig } = require('../../helpers/testUtils');
const { fetchFakeS3ProviderBuckets } = require('../../helpers/Providers');

describe('The IngestGranule workflow ingesting an 11G file', () => {
  let beforeAllFailed = false;
  let collection;
  let config;
  let granuleId;
  let ingestGranuleExecution;
  let ingestGranuleExecutionArn;
  let ingestGranuleRule;
  let prefix;
  let provider;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;
      const { fakeS3ProviderBucket } = await fetchFakeS3ProviderBuckets();

      // Create the collection
      collection = await createCollection(
        prefix,
        {
          duplicateHandling: 'version',
          process: 'modis',
        }
      );

      // Create the S3 provider
      provider = await createProvider(prefix, { host: fakeS3ProviderBucket });

      granuleId = randomId('granule-id-');

      const ingestTime = Date.now() - 1000 * 30;

      // Ingest the granule the first time
      ingestGranuleRule = await createOneTimeRule(
        prefix,
        {
          workflow: 'IngestGranule',
          collection: pick(collection, ['name', 'version']),
          provider: provider.id,
          payload: {
            testExecutionId: randomId('test-execution-'),
            granules: [
              {
                granuleId,
                dataType: collection.name,
                version: collection.version,
                files: [
                  {
                    name: '11G.dat',
                    path: '',
                  },
                ],
              },
            ],
          },
        }
      );

      // Find the execution ARN
      ingestGranuleExecutionArn = await findExecutionArn(
        prefix,
        (execution) => {
          const executionId = get(execution, 'originalPayload.testExecutionId');
          return executionId === ingestGranuleRule.payload.testExecutionId;
        },
        {
          timestamp__from: ingestTime,
          'originalPayload.testExecutionId': ingestGranuleRule.payload.testExecutionId,
        },
        { timeout: 60 }
      );

      console.log(`Waiting for ${ingestGranuleExecutionArn} to complete`);

      // Wait for the execution to be completed
      ingestGranuleExecution = await getExecutionWithStatus({
        prefix,
        arn: ingestGranuleExecutionArn,
        status: 'completed',
        timeout: 120,
      });

      // Wait for the granule to be fully ingested
      await getGranuleWithStatus({ prefix,
        granuleId,
        collectionId: encodedConstructCollectionId(collection.name, collection.version),
        status: 'completed' });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('succeeds', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      // If the `beforeAll` succeeded then this will always be true, but it
      // seemed sad to just say `expect.nothing()` after all that work.
      expect(ingestGranuleExecution.status).toBe('completed');
    }
  });

  afterAll(async () => {
    // Must delete rules before deleting associated collection and provider
    await pAll(
      [
        () => deleteRule({ prefix, ruleName: get(ingestGranuleRule, 'name') }),
      ],
      { stopOnError: false }
    ).catch(console.error);

    await deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleExecutionArn });
    await deleteGranule({ prefix, granuleId, collectionId: encodedConstructCollectionId(collection.name, collection.version) });
    await pAll(
      [
        () => deleteProvider({ prefix, providerId: get(provider, 'id') }),
        () => deleteCollection({
          prefix,
          collectionName: get(collection, 'name'),
          collectionVersion: get(collection, 'version'),
        }),
      ],
      { stopOnError: false }
    ).catch(console.error);
  });
});
