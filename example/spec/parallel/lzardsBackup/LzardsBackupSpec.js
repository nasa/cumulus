'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const path = require('path');
const pTimeout = require('p-timeout');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { lambda } = require('@cumulus/aws-client/services');
const { putFile } = require('@cumulus/aws-client/S3');

const { loadConfig } = require('../../helpers/testUtils');

describe('The Lzards Backup Task ', () => {
  let beforeAllFailed = false;
  let collection;
  let FunctionName;
  let functionConfig;
  let prefix;
  let provider;
  let ingestBucket;
  let ingestPath;
  let lzardsBackupOutput;

  beforeAll(async () => {
    try {
      const config = await loadConfig();
      prefix = config.stackName;
      ingestBucket = config.buckets.protected.name;
      ingestPath = `${ingestBucket}/${prefix}/lzardsBackupSpec`;
      await putFile(ingestBucket, `${prefix}/lzardsBackupSpec/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${prefix}/lzardsBackupSpec/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));
      FunctionName = `${prefix}-LzardsBackup`;
      functionConfig = await lambda().getFunctionConfiguration({
        FunctionName,
      }).promise();

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

      const Payload = JSON.stringify({
        cma: {
          ReplaceConfig: {
            Path: '$.payload',
            TargetPath: '$.payload',
          },
          task_config: {
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
                  granuleId: 'FakeGranule2',
                  dataType: collection.name,
                  version: collection.version,
                  files: [
                    {
                      name: 'foo.jpg',
                      filename: `s3://${ingestPath}/testGranule.jpg`,
                      checksumType: 'md5',
                      checksum: '5799f9560b232baf54337d334179caa0',
                    },
                    {
                      name: 'foo.dat',
                      filename: `s3://${ingestPath}/testGranule.dat`,
                      checksumType: 'md5',
                      checksum: '39a870a194a787550b6b5d1f49629236',
                    },
                  ],
                },
              ],
            },
          },
        },
      });

      lzardsBackupOutput = await pTimeout(
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
      expect(lzardsBackupOutput.FunctionError).toBe(undefined);
    }
  });

  it('has the expected backup information', () => {
    const backupStatus = JSON.parse(lzardsBackupOutput.Payload).meta.backupStatus;
    expect(backupStatus[0].status).toBe('COMPLETED');
    expect(backupStatus[0].statusCode).toBe(201);
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
