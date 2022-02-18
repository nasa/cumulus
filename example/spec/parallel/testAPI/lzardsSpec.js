'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const path = require('path');
const pTimeout = require('p-timeout');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { lambda } = require('@cumulus/aws-client/services');
const { putFile } = require('@cumulus/aws-client/S3');
const {
  submitGetRequestToLzards,
} = require('@cumulus/api-client/lzards');
const { loadConfig } = require('../../helpers/testUtils');

describe('The LZARDS API', () => {
  let beforeAllError;
  let config;
  let prefix;
  let collection;
  let ingestBucket;
  let ingestPath;
  let FunctionName;
  let functionConfig;
  let lzardsBackupOutput;
  let backedUpGranuleId;
  let notBackedUpGranuleId;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;
      let provider;
      ingestBucket = config.buckets.protected.name;
      ingestPath = `${prefix}/lzardsBackupSpec`;
      await putFile(ingestBucket, `${ingestPath}/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));
      FunctionName = `${prefix}-LzardsBackup`;
      backedUpGranuleId = 'FakeGranule2';
      notBackedUpGranuleId = 'NotBackedUp';
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
                  granuleId: backedUpGranuleId,
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
      beforeAllError = error;
    }
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

  describe('the LZARDS Api', () => {
    it('backs a granule up to LZARDS through the LZARDS backup task', () => {
      if (beforeAllError) fail('beforeAll() failed');
      else {
        expect(lzardsBackupOutput.FunctionError).toBe(undefined);
      }
    });

    it('sends a get request to LZARDS for the status of a granule that has been backed up and receives a 200', async () => {
      const response = await submitGetRequestToLzards({
        prefix,
        query: `metadata[collection]=${collection}&metadata[granuleId]=${backedUpGranuleId}`,
      });
      expect(response.statusCode).toBe(200);
    });

    it('sends a get request to LZARDS for the status of a granule that has not been backed up and receives a 404', async () => {
      const response = await submitGetRequestToLzards({
        prefix,
        query: `metadata[collection]=${collection}&metadata[granuleId]=${notBackedUpGranuleId}`,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
