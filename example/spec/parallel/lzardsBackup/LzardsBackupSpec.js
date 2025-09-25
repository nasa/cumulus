'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const path = require('path');
const pTimeout = require('p-timeout');

const {
  GetFunctionConfigurationCommand,
  InvokeCommand,
} = require('@aws-sdk/client-lambda');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { lambda } = require('@cumulus/aws-client/services');
const { putFile } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { loadConfig } = require('../../helpers/testUtils');

describe('The Lzards Backup Task ', () => {
  let beforeAllFailed;
  let granuleId;
  let collection;
  let config;
  let FunctionName;
  let functionConfig;
  let prefix;
  let ingestBucket;
  let ingestPath;
  let lzardsBackupOutput;
  let provider;

  const now = new Date().getTime();
  const tenMinutesAgo = now - (1000 * 60 * 10);

  const testSetup = async (configOverride = {}) => {
    try {
      beforeAllFailed = false;
      config = await loadConfig();
      prefix = config.stackName;
      ingestBucket = config.buckets.protected.name;
      ingestPath = `${prefix}/lzardsBackupSpec`;
      await putFile(ingestBucket, `${ingestPath}/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));
      await putFile(ingestBucket, `${ingestPath}/testGranule2.dat`, path.join(__dirname, 'test_data', 'testGranule2.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule2.jpg`, path.join(__dirname, 'test_data', 'testGranule2.jpg'));
      await putFile(ingestBucket, `${ingestPath}/testGranule3.dat`, path.join(__dirname, 'test_data', 'testGranule3.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule3.jpg`, path.join(__dirname, 'test_data', 'testGranule3.jpg'));
      FunctionName = `${prefix}-LzardsBackup`;
      functionConfig = await lambda().send(new GetFunctionConfigurationCommand({
        FunctionName,
      }));
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

      const configObject = {
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
              stack: config.stackName,
            },
            payload: {
              granules: [
                {
                  granuleId,
                  dataType: collection.name,
                  version: collection.version,
                  provider,
                  createdAt: tenMinutesAgo,
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
                    {
                      fileName: 'testGranule2.jpg',
                      bucket: ingestBucket,
                      key: `${ingestPath}/testGranule2.jpg`,
                      checksumType: 'sha256',
                      checksum: 'cf27948e5b84c8b3254162a77193ae02e4971da6313ddffaf075c45d7ca03fce',
                    },
                    {
                      fileName: 'testGranule2.dat',
                      bucket: ingestBucket,
                      key: `${ingestPath}/testGranule2.dat`,
                      checksumType: 'sha256',
                      checksum: 'cf27948e5b84c8b3254162a77193ae02e4971da6313ddffaf075c45d7ca03fce',
                    },
                    {
                      fileName: 'testGranule3.jpg',
                      bucket: ingestBucket,
                      key: `${ingestPath}/testGranule3.jpg`,
                      checksumType: 'sha512',
                      checksum: 'ceabc00b6c6d0b58c8dfa8e398808e217e893b01e4bf617e043d18d8680275285ad8dcd2aff88916d49a115ad76f8af5966f75cef481ab4764355254655fac2b',
                    },
                    {
                      fileName: 'testGranule3.dat',
                      bucket: ingestBucket,
                      key: `${ingestPath}/testGranule3.dat`,
                      checksumType: 'sha512',
                      checksum: 'ceabc00b6c6d0b58c8dfa8e398808e217e893b01e4bf617e043d18d8680275285ad8dcd2aff88916d49a115ad76f8af5966f75cef481ab4764355254655fac2b',
                    },
                  ],
                },
              ],
            },
          },
        },
      };

      configObject.cma.task_config = { ...configObject.cma.task_config, ...configOverride.task_config };

      const Payload = new TextEncoder().encode(
        JSON.stringify({ ...configObject, ...configOverride })
      );

      lzardsBackupOutput = await pTimeout(
        lambda().send(new InvokeCommand({ FunctionName, Payload })),
        (functionConfig.Timeout + 10) * 1000
      );

      console.log(`generated collection: ${JSON.stringify(collection)}`);
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  };

  describe('The Lzards Backup Task with override configured', () => {
    it('invokes successfully', async () => {
      const taskConfig = {
        lzardsProvider: 'BOGUS_PROVIDER',
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
      };

      await testSetup({ task_config: taskConfig });
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(lzardsBackupOutput.FunctionError).toBe(undefined);
      }
    });

    it('has the expected backup information', () => {
      const backupStatus = JSON.parse(new TextDecoder('utf-8').decode(lzardsBackupOutput.Payload)).meta.backupStatus;
      console.log(`backupStatus: ${JSON.stringify(backupStatus)}`);
      expect(backupStatus[0].status).toBe('FAILED');
      expect(backupStatus[0].body).toContain('Unprocessable Entity');
    });
  });

  describe('The Lzards Backup Task', () => {
    it('invokes successfully', async () => {
      await testSetup();
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(lzardsBackupOutput.FunctionError).toBe(undefined);
      }
    });

    it('has the expected backup information', () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      const backupStatus = JSON.parse(new TextDecoder('utf-8').decode(lzardsBackupOutput.Payload)).meta.backupStatus;
      console.log(`backupStatus: ${JSON.stringify(backupStatus)}`);
      expect(backupStatus[0].status).toBe('COMPLETED');
      expect(backupStatus[0].statusCode).toBe(201);
      expect(backupStatus[0].granuleId).toBe(granuleId);
      expect(backupStatus[0].producerGranuleId).toBe(granuleId);
      expect(backupStatus[0].provider).toBe(provider);
      expect(backupStatus[0].createdAt).toBe(tenMinutesAgo);
      expect(backupStatus[0].collectionId).toBe(constructCollectionId(collection.name, collection.version));
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
