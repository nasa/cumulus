'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const path = require('path');
const pTimeout = require('p-timeout');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { lambda } = require('@cumulus/aws-client/services');
const { putFile } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { encodedConstructCollectionId } = require('../../helpers/Collections');

const { loadConfig } = require('../../helpers/testUtils');

describe('The Lzards Backup Task with distribution URL', () => {
  let beforeAllFailed = false;
  let granuleId;
  let collection;
  let FunctionName;
  let functionConfig;
  let prefix;
  let provider;
  let ingestBucket;
  let ingestPath;
  let lzardsBackupOutput;

  const now = new Date().getTime();

  beforeAll(async () => {
    try {
      const config = await loadConfig();
      prefix = config.stackName;
      ingestBucket = config.buckets.protected.name;
      ingestPath = `${prefix}/lzardsBackupFromDistributionSpec`;
      await putFile(ingestBucket, `${ingestPath}/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));
      FunctionName = `${prefix}-LzardsBackup`;
      functionConfig = await lambda().getFunctionConfiguration({
        FunctionName,
      });
      granuleId = `FakeGranule_${randomString()}`;
      provider = `FakeProvider_${randomString()}`;

      // Create the collection
      collection = await createCollection(
        prefix,
        {
          files: [
            {
              bucket: 'protected',
              regex: '^[^.]+\.jpg$',
              lzards: { backup: true },
              sampleFileName: 'asdf.jpg',
            },
            {
              bucket: 'protected',
              regex: '^[^.]+\.dat$',
              sampleFileName: 'asdf.dat',
            },
          ],
        }
      );

      const Payload = new TextEncoder().encode(JSON.stringify({
        cma: {
          ReplaceConfig: {
            Path: '$.payload',
            TargetPath: '$.payload',
          },
          task_config: {
            urlType: 'cloudfront',
            cloudfrontEndpoint: 'http://d111111abcdef8.cloudfront.net/',
            cumulus_message: {
              outputs: [
                {
                  source: '{$.originalPayload}',
                  destination: '{$.payload}',
                },
                {
                  source: '{$.backupResults}',
                  destination: '{$.meta.backupStatus}',
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
                  provider: provider,
                  createdAt: now,
                  files: [
                    {
                      fileName: 'testGranule.jpg',
                      bucket: ingestBucket,
                      key: `${ingestPath}/testGranule.jpg`,
                      checksumType: 'md5',
                      checksum: '5799f9560b232baf54337d334179caa0',
                    },
                    {
                      fileName: 'testGranule.dat',
                      bucket: ingestBucket,
                      key: `${ingestPath}/testGranule.dat`,
                      checksumType: 'md5',
                      checksum: '39a870a194a787550b6b5d1f49629236',
                    },
                  ],
                },
              ],
            },
          },
        },
      }));

      lzardsBackupOutput = await pTimeout(
        lambda().invoke({ FunctionName, Payload }),
        (functionConfig.Timeout + 10) * 1000
      );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('succeeds', () => {
    console.log(`lzardsBackupOutput: ${JSON.stringify(lzardsBackupOutput)}`);
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(lzardsBackupOutput.FunctionError).toBe(undefined);
    }
  });

  it('has the expected backup information', () => {
    const backupStatus = JSON.parse(new TextDecoder('utf-8').decode(lzardsBackupOutput.Payload)).meta.backupStatus;
    expect(backupStatus[0].status).toBe('COMPLETED');
    expect(backupStatus[0].statusCode).toBe(201);
    expect(backupStatus[0].granuleId).toBe(granuleId);
    expect(backupStatus[0].provider).toBe(provider);
    expect(backupStatus[0].createdAt).toBe(now);
    expect(backupStatus[0].collectionId).toBe(encodedConstructCollectionId(collection.name, collection.version));
  });

  afterAll(async () => {
    await pAll(
      [
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
