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
  let lzardsApiGetFunctionName;
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
      ingestPath = `${prefix}/lzardsBackupSpec`;
      await putFile(ingestBucket, `${ingestPath}/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));
      FunctionName = `${prefix}-LzardsBackup`;
      lzardsApiGetFunctionName = `${prefix}-LzardsApiClientTest`;
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

  describe('The Lzards API Client', () => {
    it('returns information for granules successfully backed up to lzards', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        const lzardsGetPayload = JSON.stringify({
          searchParams: {
            'metadata[collection]': `${collection.name}___${collection.version}`,
            'metadata[granuleId]': 'FakeGranule2',
          },
        });

        const lzardsApiGetOutput = await pTimeout(
          lambda().invoke({ FunctionName: lzardsApiGetFunctionName, Payload: lzardsGetPayload }).promise(),
          (functionConfig.Timeout + 10) * 1000
        );

        const payload = JSON.parse(lzardsApiGetOutput.Payload);

        expect(lzardsApiGetOutput.FunctionError).toBe(undefined);
        expect(payload.count).toBe(1);
        expect(payload.items[0].metadata.granuleId).toBe('FakeGranule2');
        expect(payload.items[0].metadata.collection).toBe(`${collection.name}___${collection.version}`);
      }
    });

    it('returns no results for granules not backed up', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        const lzardsGetPayload = JSON.stringify({
          searchParams: {
            'metadata[collection]': 'notBackedUpCollectionName',
            'metadata[granuleId]': 'FakeGranule2',
          },
        });

        const lzardsApiGetOutput = await pTimeout(
          lambda().invoke({ FunctionName: lzardsApiGetFunctionName, Payload: lzardsGetPayload }).promise(),
          (functionConfig.Timeout + 10) * 1000
        );

        const payload = JSON.parse(lzardsApiGetOutput.Payload);

        expect(lzardsApiGetOutput.FunctionError).toBe(undefined);
        expect(payload.count).toBe(0);
      }
    });
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
