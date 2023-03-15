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
const { constructCollectionId } = require('@cumulus/message/Collections');
const { loadConfig } = require('../../helpers/testUtils');

describe('The Lzards Backup Task ', () => {
  let beforeAllFailed = false;
  let granuleId;
  let collection;
  let config;
  let FunctionName;
  let lzardsApiGetFunctionName;
  let functionConfig;
  let prefix;
  let ingestBucket;
  let ingestPath;
  let lzardsBackupOutput;
  let provider;

  const now = new Date().getTime();
  const thirtyMinutesAgo = now - (1000 * 60 * 30);
  const tenMinutesAgo = now - (1000 * 60 * 10);
  const twoMinutesAgo = now - (1000 * 60 * 2);

  beforeAll(async () => {
    try {
      config = await loadConfig();
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

      console.log(`generated collection: ${JSON.stringify(collection)}`);
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  const createPayloadWithChecksumType = (checksumType, checksum1, checksum2) => JSON.stringify(
    {
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
                    checksumType: checksumType,
                    checksum: checksum1,
                  },
                  {
                    fileName: 'testGranule.dat',
                    bucket: ingestBucket,
                    key: `${ingestPath}/testGranule.dat`,
                    checksumType: checksumType,
                    checksum: checksum2,
                  },
                ],
              },
            ],
          },
        },
      },
    }
  );

  describe('With an md5 checksum', () => {
    beforeAll(async () => {
      const checksum1 = '5799f9560b232baf54337d334179caa0';
      const checksum2 = '39a870a194a787550b6b5d1f49629236';
      const payloadWithMd5Checksum = createPayloadWithChecksumType('md5', checksum1, checksum2);

      lzardsBackupOutput = await pTimeout(
        lambda().invoke({ FunctionName, Payload: payloadWithMd5Checksum }).promise(),
        (functionConfig.Timeout + 10) * 1000
      );
    });
    it('succeeds', () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(lzardsBackupOutput.FunctionError).toBe(undefined);
      }
    });

    it('has the expected backup information', () => {
      const backupStatus = JSON.parse(lzardsBackupOutput.Payload).meta.backupStatus;
      console.log(`backupStatus: ${JSON.stringify(backupStatus)}`);
      expect(backupStatus[0].status).toBe('COMPLETED');
      expect(backupStatus[0].statusCode).toBe(201);
      expect(backupStatus[0].granuleId).toBe(granuleId);
      expect(backupStatus[0].provider).toBe(provider);
      expect(backupStatus[0].createdAt).toBe(tenMinutesAgo);
      expect(backupStatus[0].collectionId).toBe(constructCollectionId(collection.name, collection.version));
    });
  });

  describe('With an sha256 checksum', () => {
    beforeAll(async () => {
      const checksum1 = '6fafafa6384f939c983d04ad0ffa2dec4ffac22849b3fc7a22f1c6063acc0db3';
      const checksum2 = '5bb9ddb36633012eb2ec971b0b9fca3ed71878cb7c64252208f4426ec19eeb65';
      const payloadWithSha256Checksum = createPayloadWithChecksumType('sha256', checksum1, checksum2);

      lzardsBackupOutput = await pTimeout(
        lambda().invoke({ FunctionName, Payload: payloadWithSha256Checksum }).promise(),
        (functionConfig.Timeout + 10) * 1000
      );
    });
    it('succeeds', () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(lzardsBackupOutput.FunctionError).toBe(undefined);
      }
    });

    it('has the expected backup information', () => {
      const backupStatus = JSON.parse(lzardsBackupOutput.Payload).meta.backupStatus;
      console.log(`backupStatus: ${JSON.stringify(backupStatus)}`);
      expect(backupStatus[0].status).toBe('COMPLETED');
      expect(backupStatus[0].statusCode).toBe(201);
      expect(backupStatus[0].granuleId).toBe(granuleId);
      expect(backupStatus[0].provider).toBe(provider);
      expect(backupStatus[0].createdAt).toBe(tenMinutesAgo);
      expect(backupStatus[0].collectionId).toBe(constructCollectionId(collection.name, collection.version));
    });
  });

  describe('With an sha512 checksum', () => {
    beforeAll(async () => {
      const checksum1 = '386bff951dbf6c7329c9cfccfe65b29f13d9c58e39dd56d65357150ba18124af96506cf4752f70ac14f0513b032bc5ef6953eb0eedb64c55a5641420633ba1a0';
      const checksum2 = '383502dcb509bbc9f3cad73202397e4f8db08ef6ec09e5dd498fe735d2d0c68b6ea3b27c3bfdd494d1fed7ce9e3786af77d0e126a4faa834ee9e86e998ff19a7';
      const payloadWithSha512Checksum = createPayloadWithChecksumType('sha512', checksum1, checksum2);

      lzardsBackupOutput = await pTimeout(
        lambda().invoke({ FunctionName, Payload: payloadWithSha512Checksum }).promise(),
        (functionConfig.Timeout + 10) * 1000
      );
    });
    it('succeeds', () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(lzardsBackupOutput.FunctionError).toBe(undefined);
      }
    });

    it('has the expected backup information', () => {
      const backupStatus = JSON.parse(lzardsBackupOutput.Payload).meta.backupStatus;
      console.log(`backupStatus: ${JSON.stringify(backupStatus)}`);
      expect(backupStatus[0].status).toBe('COMPLETED');
      expect(backupStatus[0].statusCode).toBe(201);
      expect(backupStatus[0].granuleId).toBe(granuleId);
      expect(backupStatus[0].provider).toBe(provider);
      expect(backupStatus[0].createdAt).toBe(tenMinutesAgo);
      expect(backupStatus[0].collectionId).toBe(constructCollectionId(collection.name, collection.version));
    });
  });

  describe('The Lzards API Client', () => {
    it('throws an error when no search parameters are provided', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        const lzardsGetPayload = JSON.stringify({ searchParams: {} });
        const lzardsApiGetOutput = await pTimeout(
          lambda().invoke({ FunctionName: lzardsApiGetFunctionName, Payload: lzardsGetPayload }).promise(),
          (functionConfig.Timeout + 10) * 1000
        );

        const payload = JSON.parse(lzardsApiGetOutput.Payload);

        expect(lzardsApiGetOutput.FunctionError).toBe('Unhandled');
        expect(payload.errorMessage).toBe('The required searchParams is not provided or empty');
      }
    });

    it('returns info for a request for a single granule successfully backed up to lzards', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        const lzardsGetPayload = JSON.stringify({
          searchParams: {
            'metadata[collection]': `${collection.name}___${collection.version}`,
            'metadata[granuleId]': granuleId,
          },
        });
        const lzardsApiGetOutput = await pTimeout(
          lambda().invoke({ FunctionName: lzardsApiGetFunctionName, Payload: lzardsGetPayload }).promise(),
          (functionConfig.Timeout + 50) * 1000
        );

        const payload = JSON.parse(lzardsApiGetOutput.Payload);

        expect(lzardsApiGetOutput.FunctionError).toBe(undefined);
        expect(payload.count).toBe(3);
        expect(payload.items[0].metadata.granuleId).toBe(granuleId);
        expect(payload.items[0].metadata.collection).toBe(`${collection.name}___${collection.version}`);
        expect(payload.items[0].metadata.createdAt).toBe(tenMinutesAgo);
      }
    });

    it('returns info for a request with date range provided', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        const lzardsGetPayload = JSON.stringify({
          searchParams: {
            pageLimit: 25,
            'metadata[provider]': provider,
            'metadata[createdAt][gte]': thirtyMinutesAgo,
            'metadata[createdAt][lte]': twoMinutesAgo,
          },
        });

        const lzardsApiGetOutput = await pTimeout(
          lambda().invoke({ FunctionName: lzardsApiGetFunctionName, Payload: lzardsGetPayload }).promise(),
          (functionConfig.Timeout + 10) * 1000
        );

        const payload = JSON.parse(lzardsApiGetOutput.Payload);

        expect(lzardsApiGetOutput.FunctionError).toBe(undefined);
        expect(payload.count).toBe(3);
        expect(new Date(payload.items[0].metadata.createdAt).getTime()).toBeGreaterThanOrEqual(thirtyMinutesAgo);
        expect(new Date(payload.items[0].metadata.createdAt).getTime()).toBeLessThanOrEqual(twoMinutesAgo);
        expect(payload.items[0].metadata.provider).toBe(provider);
      }
    });

    it('returns no results for granules not backed up', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        const lzardsGetPayload = JSON.stringify({
          searchParams: {
            'metadata[collection]': 'notBackedUpCollectionName',
            'metadata[granuleId]': granuleId,
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
