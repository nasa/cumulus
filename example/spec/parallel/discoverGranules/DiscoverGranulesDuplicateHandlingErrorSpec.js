'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const pick = require('lodash/pick');
const { randomId } = require('@cumulus/common/test-utils');

const { createCollection } = require('@cumulus/integration-tests/collections');
const {
  findExecutionArn,
  getCompletedExecution,
  getFailedExecution
} = require('@cumulus/integration-tests/executions');
const { getCompletedGranule } = require('@cumulus/integration-tests/granules');
const { createProvider } = require('@cumulus/integration-tests/providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/rules');

const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');

const { deleteS3Object, s3PutObject } = require('@cumulus/aws-client/S3');

const { loadConfig } = require('../../helpers/testUtils');

describe('The DiscoverGranules workflow with an existing granule and duplicateHandling="error"', () => {
  let beforeAllFailed = false;
  let collection;
  let discoverGranulesExecutionArn;
  let discoverGranulesRule;
  let existingGranuleId;
  let existingGranuleKey;
  let ingestGranuleRule;
  let prefix;
  let provider;
  let sourceBucket;

  beforeAll(async () => {
    try {
      const config = await loadConfig();
      prefix = config.stackName;
      sourceBucket = config.bucket;

      // The S3 path where granules will be ingested from
      const sourcePath = `${prefix}/tmp/${randomId('test-')}`;

      // Create the collection
      collection = await createCollection(
        prefix,
        {
          duplicateHandling: 'error',
          provider_path: `${sourcePath}/`
        }
      );

      // Create the S3 provider
      provider = await createProvider(prefix, { host: sourceBucket });

      // Stage the existing granule file to S3
      existingGranuleId = randomId('existing-granule-');
      existingGranuleKey = `${sourcePath}/${existingGranuleId}.txt`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: existingGranuleKey,
        Body: 'asdf'
      });

      // Ingest the existing granule
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
                granuleId: existingGranuleId,
                dataType: collection.name,
                version: collection.version,
                files: [
                  {
                    name: `${existingGranuleId}.txt`,
                    path: sourcePath
                  }
                ]
              }
            ]
          }
        }
      );

      // Find the "IngestGranule" execution ARN
      const ingestGranuleExecutionArn = await findExecutionArn(
        prefix,
        (execution) =>
          get(execution, 'originalPayload.testExecutionId') === ingestGranuleRule.payload.testExecutionId,
        { timeout: 15 }
      );

      // Wait for the "IngestGranule" execution to be completed
      await getCompletedExecution({ prefix, arn: ingestGranuleExecutionArn });

      // Wait for the existing granule to be fully ingested
      await getCompletedGranule({ prefix, granuleId: existingGranuleId });

      // Run DiscoverGranules
      discoverGranulesRule = await createOneTimeRule(
        prefix,
        {
          workflow: 'DiscoverGranules',
          collection: {
            name: collection.name,
            version: collection.version
          },
          provider: provider.id,
          payload: {
            testExecutionId: randomId('test-execution-')
          }
        }
      );

      // Find the "DiscoverGranules" execution ARN
      discoverGranulesExecutionArn = await findExecutionArn(
        prefix,
        (execution) =>
          get(execution, 'originalPayload.testExecutionId') === discoverGranulesRule.payload.testExecutionId,
        { timeout: 15 }
      );
    } catch (err) {
      beforeAllFailed = true;
      console.error(err);
      throw err;
    }
  });

  it('fails the DiscoverGranules workflow', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const execution = await getFailedExecution({ prefix, arn: discoverGranulesExecutionArn });

      const errorCause = JSON.parse(get(execution, 'error.Cause', {}));
      expect(errorCause.errorMessage)
        .toBe(`Duplicate granule found for ${existingGranuleId} with duplicate configuration set to error`);
    }
  });

  afterAll(async () => {
    // Must delete rules before deleting associated collection and provider
    await pAll(
      [
        () => deleteRule({ prefix, ruleName: get(ingestGranuleRule, 'name') }),
        () => deleteRule({ prefix, ruleName: get(discoverGranulesRule, 'name') })
      ],
      { stopOnError: false }
    ).catch(console.error);

    await pAll(
      [
        () => deleteS3Object(sourceBucket, existingGranuleKey),
        () => deleteGranule({ prefix, granuleId: existingGranuleId }),
        () => deleteProvider({ prefix, providerId: get(provider, 'id') }),
        () => deleteCollection({
          prefix,
          collectionName: get(collection, 'name'),
          collectionVersion: get(collection, 'version')
        })
      ],
      { stopOnError: false }
    ).catch(console.error);
  });
});
