'use strict';

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

describe('The SyncGranule task with a 1 GB file to be checksummed', () => {
  let beforeAllFailed = false;
  let collection;
  let granuleId;
  let prefix;
  let provider;
  let syncGranuleOutput;

  beforeAll(async () => {
    try {
      const config = await loadConfig();

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

      const FunctionName = `${prefix}-SyncGranule`;

      const functionConfig = await lambda().send(new GetFunctionConfigurationCommand({
        FunctionName,
      }));

      const Payload = new TextEncoder().encode(JSON.stringify({
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
                    { name: '1G.dat.sha256', path: '' },
                    { name: '1G.dat', path: '' },
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

  it('succeeds', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(syncGranuleOutput.FunctionError).toBe(undefined);

      const parsedPayload = JSON.parse(new TextDecoder('utf-8').decode(syncGranuleOutput.Payload));
      expect(parsedPayload.exception).toBe('None');
    }
  });

  afterAll(async () => {
    const parsedPayload = JSON.parse(new TextDecoder('utf-8').decode(syncGranuleOutput.Payload));
    const fullTaskOutput = await pullStepFunctionEvent(parsedPayload);

    const file = fullTaskOutput.payload.granules[0].files[0];

    await pAll(
      [
        () => S3.deleteS3Object(file.bucket, file.key),
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
