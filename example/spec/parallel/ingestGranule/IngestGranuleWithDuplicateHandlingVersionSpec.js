'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const pick = require('lodash/pick');
const { randomId } = require('@cumulus/common/test-utils');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const {
  findExecutionArn, getExecutionWithStatus
} = require('@cumulus/integration-tests/Executions');
const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');

const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');

const { deleteS3Object, s3PutObject } = require('@cumulus/aws-client/S3');

const { loadConfig } = require('../../helpers/testUtils');

describe('The IngestGranule workflow with DuplicateHandling="version" and a granule re-ingested with one new file, one unchanged existing file, and one modified file', () => {
  let beforeAllFailed = false;
  let collection;
  let differentChecksumFilename;
  let differentChecksumKey;
  let firstIngestGranuleRule;
  let granuleId;
  let newFileFilename;
  let newFileKey;
  let prefix;
  let provider;
  let sameChecksumFilename;
  let sameChecksumKey;
  let secondIngestGranuleExecution;
  let secondIngestGranuleRule;
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
          duplicateHandling: 'version',
          process: 'modis'
        }
      );

      // Create the S3 provider
      provider = await createProvider(prefix, { host: sourceBucket });

      // Stage the granule files to S3
      sameChecksumFilename = `${randomId('file-with-same-checksum-')}.txt`;
      sameChecksumKey = `${sourcePath}/${sameChecksumFilename}`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: sameChecksumKey,
        Body: 'asdf'
      });

      differentChecksumFilename = `${randomId('file-with-different-checksum-')}.txt`;
      differentChecksumKey = `${sourcePath}/${differentChecksumFilename}`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: differentChecksumKey,
        Body: 'original contents'
      });

      granuleId = randomId('granule-id-');

      const ingestTime = Date.now() - 1000 * 30;

      // Ingest the granule the first time
      firstIngestGranuleRule = await createOneTimeRule(
        prefix,
        {
          workflow: 'IngestGranule',
          collection: pick(collection, ['name', 'version']),
          provider: provider.id,
          payload: {
            testExecutionId: randomId('test-execution-'),
            granules: [
              {
                granuleId,
                dataType: collection.name,
                version: collection.version,
                files: [
                  {
                    name: sameChecksumFilename,
                    path: sourcePath
                  },
                  {
                    name: differentChecksumFilename,
                    path: sourcePath
                  }
                ]
              }
            ]
          }
        }
      );

      // Find the execution ARN
      const firstIngestGranuleExecutionArn = await findExecutionArn(
        prefix,
        (execution) => {
          const executionId = get(execution, 'originalPayload.testExecutionId');
          return executionId === firstIngestGranuleRule.payload.testExecutionId;
        },
        { timestamp__from: ingestTime },
        { timeout: 15 }
      );

      // Wait for the execution to be completed
      await getExecutionWithStatus({
        prefix,
        arn: firstIngestGranuleExecutionArn,
        status: 'completed'
      });

      // Wait for the granule to be fully ingested
      await getGranuleWithStatus({ prefix, granuleId, status: 'completed' });

      // Modify the contents of the updated granule file
      await s3PutObject({
        Bucket: sourceBucket,
        Key: differentChecksumKey,
        Body: 'new contents'
      });

      // Create a new granule file
      newFileFilename = `${randomId('new-file-')}.txt`;
      newFileKey = `${sourcePath}/${newFileFilename}`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: newFileKey,
        Body: 'asdf'
      });

      // Re-ingest the updated granule
      secondIngestGranuleRule = await createOneTimeRule(
        prefix,
        {
          workflow: 'IngestGranule',
          collection: pick(collection, ['name', 'version']),
          provider: provider.id,
          payload: {
            testExecutionId: randomId('test-execution-'),
            granules: [
              {
                granuleId,
                dataType: collection.name,
                version: collection.version,
                files: [
                  {
                    name: sameChecksumFilename,
                    path: sourcePath
                  },
                  {
                    name: differentChecksumFilename,
                    path: sourcePath
                  },
                  {
                    name: newFileFilename,
                    path: sourcePath
                  }
                ]
              }
            ]
          }
        }
      );

      // Find the execution ARN
      const secondIngestGranuleExecutionArn = await findExecutionArn(
        prefix,
        (execution) => {
          const executionId = get(execution, 'originalPayload.testExecutionId');
          return executionId === secondIngestGranuleRule.payload.testExecutionId;
        },
        { timestamp__from: ingestTime },
        { timeout: 15 }
      );

      // Wait for the execution to be completed
      secondIngestGranuleExecution = await getExecutionWithStatus({
        prefix,
        arn: secondIngestGranuleExecutionArn,
        status: 'completed'
      });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('returns the expected files', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const files = secondIngestGranuleExecution.finalPayload.granules[0].files;

      // Make sure we got the expected number of files
      expect(files.length).toBe(5);

      // Make sure the three ingested files are present
      expect(files.find((file) => file.name === sameChecksumFilename)).toBeDefined();
      expect(files.find((file) => file.name === differentChecksumFilename)).toBeDefined();
      expect(files.find((file) => file.name === newFileFilename)).toBeDefined();

      // Make sure the generated CMR file is present
      expect(files.find((file) => file.name === `${granuleId}.cmr.xml`)).toBeDefined();

      // Make sure that the modified file resulted in a versioned file
      expect(
        files.find((file) => file.name.startsWith(`${differentChecksumFilename}.v`))
      ).toBeDefined();
    }
  });

  afterAll(async () => {
    // Must delete rules before deleting associated collection and provider
    await pAll(
      [
        () => deleteRule({ prefix, ruleName: get(firstIngestGranuleRule, 'name') }),
        () => deleteRule({ prefix, ruleName: get(secondIngestGranuleRule, 'name') })
      ],
      { stopOnError: false }
    ).catch(console.error);

    await pAll(
      [
        () => deleteS3Object(sourceBucket, differentChecksumKey),
        () => deleteS3Object(sourceBucket, newFileKey),
        () => deleteS3Object(sourceBucket, sameChecksumKey),
        () => deleteGranule({ prefix, granuleId }),
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
