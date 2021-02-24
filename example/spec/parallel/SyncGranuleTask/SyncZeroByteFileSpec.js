'use strict';

const cryptoRandomString = require('crypto-random-string');
const get = require('lodash/get');
const pAll = require('p-all');
const pTimeout = require('p-timeout');
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

  // const bucket = `sync-zero-byte-file-spec-${cryptoRandomString({ length: 10 })}`;
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
      const functionConfig = await lambda().getFunctionConfiguration({
        FunctionName,
      }).promise();

      const Payload = JSON.stringify({
        cma: {
          ReplaceConfig: {
            Path: '$.payload',
            TargetPath: '$.payload',
          },
          task_config: {
            buckets: '{$.meta.buckets}',
            provider: '{$.meta.provider}',
            collection: '{$.meta.collection}',
            stack: '{$.meta.stack}',
            downloadBucket: '{$.cumulus_meta.system_bucket}',
            duplicateHandling: '{$.meta.collection.duplicateHandling}',
            pdr: '{$.meta.pdr}',
            cumulus_message: {
              input: '{$.payload}',
              outputs: [
                {
                  source: '{$.granules}',
                  destination: '{$.meta.input_granules}',
                },
                {
                  source: '{$}',
                  destination: '{$.payload}',
                },
                {
                  source: '{$.process}',
                  destination: '{$.meta.process}',
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
      });

      syncGranuleOutput = await pTimeout(
        lambda().invoke({ FunctionName, Payload }).promise(),
        (functionConfig.Timeout + 10) * 1000
      );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('succeeds', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(syncGranuleOutput.FunctionError).toBe(undefined);

      const parsedPayload = JSON.parse(syncGranuleOutput.Payload);
      expect(parsedPayload.errorType).toBe(undefined);
      expect(parsedPayload.errorMessage).toBe(undefined);
    }
  });

  afterAll(async () => {
    const parsedPayload = JSON.parse(syncGranuleOutput.Payload);
    const fullTaskOutput = await pullStepFunctionEvent(parsedPayload);

    const fileUrl = fullTaskOutput.payload.granules[0].files[0].filename;
    const parsedFileUrl = S3.parseS3Uri(fileUrl);

    await pAll(
      [
        () => S3.deleteS3Object(parsedFileUrl.Bucket, parsedFileUrl.Key),
        () => S3.recursivelyDeleteS3Bucket(bucket),
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
