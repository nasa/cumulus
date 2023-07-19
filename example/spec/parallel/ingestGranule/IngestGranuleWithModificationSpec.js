'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const pick = require('lodash/pick');

const {
  findExecutionArn,
  getExecutionWithStatus,
} = require('@cumulus/integration-tests/Executions');
const {
  getGranule,
  deleteGranule,
} = require('@cumulus/api-client/granules');

const { randomId } = require('@cumulus/common/test-utils');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');
const { deleteS3Object, s3PutObject } = require('@cumulus/aws-client/S3');
const { encodedConstructCollectionId } = require('../../helpers/Collections');

const { loadConfig } = require('../../helpers/testUtils');

describe('The IngestGranule workflow with a granule re-ingested with the collectionId modified', () => {
  let beforeAllError;
  let collection;
  let collectionId;
  let config;
  let granuleId;
  let ingestGranuleExecution1Arn;
  let ingestGranuleExecution2Arn;
  let ingestGranuleRule1;
  let ingestGranuleRule2;
  let newCollection;
  let prefix;
  let provider;
  let fileName;
  let checksumKey;
  let sourceBucket;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;
      sourceBucket = config.bucket;

      // The S3 path where granules will be ingested from
      const sourcePath = `${prefix}/tmp/${randomId('test-')}`;

      // Create the collection
      collection = await createCollection(
        prefix,
        {
          duplicateHandling: 'version',
          process: 'modis',
        }
      );

      // Create the S3 provider
      provider = await createProvider(prefix, { host: sourceBucket });

      // Stage the granule files to S3
      fileName = `${randomId('file-with-same-checksum-')}.txt`;
      checksumKey = `${sourcePath}/${fileName}`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: checksumKey,
        Body: 'some-body',
      });

      granuleId = randomId('granule-id-');

      const ingestTime = Date.now() - 1000 * 30;

      // Ingest granule the first time
      collectionId = encodedConstructCollectionId(collection.name, collection.version);
      ingestGranuleRule1 = await createOneTimeRule(
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
                collectionId,
                files: [
                  {
                    name: fileName,
                    path: sourcePath,
                  },
                ],
              },
            ],
          },
        }
      );

      // Find the execution ARN
      console.log('ingestGranuleRule1.payload.testExecutionId', ingestGranuleRule1.payload.testExecutionId);
      ingestGranuleExecution1Arn = await findExecutionArn(
        prefix,
        (execution) => {
          const executionId = get(execution, 'originalPayload.testExecutionId');
          return executionId === ingestGranuleRule1.payload.testExecutionId;
        },
        {
          timestamp__from: ingestTime,
          'originalPayload.testExecutionId': ingestGranuleRule1.payload.testExecutionId,
        },
        { timeout: 30 }
      );
      console.log('ingestGranuleExecution1Arn', ingestGranuleExecution1Arn);

      // Wait for the execution to be completed
      await getExecutionWithStatus({
        prefix,
        arn: ingestGranuleExecution1Arn,
        status: 'completed',
      });

      // Wait for the granule to be fully ingested
      await getGranuleWithStatus({ prefix, granuleId, collectionId, status: 'completed' });

      // Create a new collection
      newCollection = await createCollection(
        prefix,
        {
          duplicateHandling: 'version',
          process: 'modis',
        }
      );

      // Re-ingest the updated granule
      ingestGranuleRule2 = await createOneTimeRule(
        prefix,
        {
          workflow: 'IngestGranule',
          collection: pick(newCollection, ['name', 'version']),
          provider: provider.id,
          payload: {
            testExecutionId: randomId('test-execution-'),
            granules: [
              {
                granuleId,
                collectionId: encodedConstructCollectionId(newCollection.name, newCollection.version),
                version: collection.version,
                files: [
                  {
                    name: fileName,
                    path: sourcePath,
                  },
                ],
              },
            ],
          },
        }
      );

      // Find the execution ARN
      console.log('ingestGranuleRule2.payload.testExecutionId', ingestGranuleRule2.payload.testExecutionId);
      ingestGranuleExecution2Arn = await findExecutionArn(
        prefix,
        (execution) => {
          const executionId = get(execution, 'originalPayload.testExecutionId');
          return executionId === ingestGranuleRule2.payload.testExecutionId;
        },
        {
          timestamp__from: ingestTime,
          'originalPayload.testExecutionId': ingestGranuleRule2.payload.testExecutionId,
        },
        { timeout: 30 }
      );

      console.log('ingestGranuleExecution2Arn', ingestGranuleExecution2Arn);

      // Wait for the execution to be completed
      await getExecutionWithStatus({
        prefix,
        arn: ingestGranuleExecution2Arn,
        status: 'completed',
      });
    } catch (error) {
      beforeAllError = error;
      throw error;
    }
  });

  it('does not modify the granule collectionId', async () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      const reingestedGranule = await getGranule({
        prefix,
        granuleId,
        collectionId,
      });
      // Make sure that the collectionId is unmodified
      expect(reingestedGranule.collectionId).toBe(collectionId);
    }
  });

  afterAll(async () => {
    // Must delete rules before deleting associated collection and provider
    await pAll(
      [
        () => deleteRule({ prefix, ruleName: get(ingestGranuleRule1, 'name') }),
        () => deleteRule({ prefix, ruleName: get(ingestGranuleRule2, 'name') }),
      ],
      { stopOnError: false }
    ).catch(console.error);

    await deleteGranule({ prefix, granuleId, collectionId });
    await Promise.all([
      deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleExecution2Arn }),
      deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleExecution1Arn }),
    ]);

    await pAll(
      [
        () => deleteS3Object(sourceBucket, checksumKey),
        () => deleteProvider({ prefix, providerId: get(provider, 'id') }),
        () => deleteCollection({
          prefix,
          collectionName: get(collection, 'name'),
          collectionVersion: get(collection, 'version'),
        }),
        () => deleteCollection({
          prefix,
          collectionName: get(newCollection, 'name'),
          collectionVersion: get(newCollection, 'version'),
        }),
      ],
      { stopOnError: false }
    ).catch(console.error);
  });
});
