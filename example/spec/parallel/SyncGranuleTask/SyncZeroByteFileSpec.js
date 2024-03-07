'use strict';

/*
* Localstack does not behave the same as S3 when trying to move/sync 0 byte files with
* multipartCopyObject. Since we are unable to accurately test syncing a 0 byte file with Localstack,
* we are testing it here.
*/

const get = require('lodash/get');
const pAll = require('p-all');
const pTimeout = require('p-timeout');
const {
  GetFunctionConfigurationCommand,
  InvokeCommand,
} = require('@aws-sdk/client-lambda');

const { pullStepFunctionEvent } = require('@cumulus/message/StepFunctions');
const { randomId } = require('@cumulus/common/test-utils');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { createProvider } = require('@cumulus/integration-tests/Providers');

const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { lambda } = require('@cumulus/aws-client/services');
const S3 = require('@cumulus/aws-client/S3');

const { loadConfig } = require('../../helpers/testUtils');
const { fetchFakeS3ProviderBuckets } = require('../../helpers/Providers');

describe('The SyncGranule task with a 0 byte file to be synced', () => {
  let beforeAllFailed = false;
  let collection;
  let granuleId;
  let prefix;
  let provider;
  let syncGranuleOutput;
  let syncedObject;

  const filename = '0byte.dat';

  beforeAll(async () => {
    try {
      const config = await loadConfig();

      prefix = config.stackName;

      const { fakeS3ProviderBucket } = await fetchFakeS3ProviderBuckets();

      // Stage zero byte file for sync-granule
      await S3.s3PutObject({
        Bucket: fakeS3ProviderBucket,
        Key: filename,
        Body: '',
      });

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

      const FunctionName = `${prefix}-SyncGranule`;
      const functionConfig = await lambda().send(new GetFunctionConfigurationCommand({
        FunctionName,
      }));

      const Payload = new TextEncoder().encode(JSON.stringify({
        cma: {
          task_config: {
            buckets: '{$.meta.buckets}',
            provider: '{$.meta.provider}',
            collection: '{$.meta.collection}',
            stack: '{$.meta.stack}',
            downloadBucket: '{$.cumulus_meta.system_bucket}',
            duplicateHandling: '{$.meta.collection.duplicateHandling}',
            cumulus_message: {
              input: '{$.payload}',
              outputs: [
                {
                  source: '{$}',
                  destination: '{$.payload}',
                },
              ],
            },
          },
          event: {
            cumulus_meta: {
              system_bucket: config.bucket,
            },
            meta: {
              buckets: config.buckets,
              collection,
              provider,
              stack: config.stackName,
            },
            payload: {
              granules: [
                {
                  granuleId,
                  dataType: collection.name,
                  version: collection.version,
                  files: [
                    {
                      bucket: fakeS3ProviderBucket,
                      name: filename,
                      path: '',
                      size: 0,
                    },
                  ],
                },
              ],
            },
          },
        },
      }));

      syncGranuleOutput = await pTimeout(
        lambda().send(new InvokeCommand({ FunctionName, Payload })),
        (functionConfig.Timeout + 10) * 1000
      );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('succeeds', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(syncGranuleOutput.FunctionError).toBe(undefined);

      const parsedPayload = JSON.parse(new TextDecoder('utf-8').decode(syncGranuleOutput.Payload));
      const fullTaskOutput = await pullStepFunctionEvent(parsedPayload);

      expect(fullTaskOutput.errorType).toBe(undefined);
      expect(fullTaskOutput.errorMessage).toBe(undefined);

      // Confirm that file was synced
      syncedObject = parsedPayload.payload.granules[0].files[0];
      expect(
        await S3.s3ObjectExists({
          Bucket: syncedObject.bucket,
          Key: syncedObject.key,
        })
      ).toBeTrue();
    }
  });

  afterAll(async () => {
    await pAll(
      [
        () => S3.deleteS3Object(syncedObject.bucket, syncedObject.key),
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
