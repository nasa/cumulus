'use strict';

const fs = require('fs-extra');

const {
  deleteS3Object,
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const {
  addCollections,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const apiTestUtils = require('@cumulus/integration-tests/api/api');
const providersApi = require('@cumulus/api-client/providers');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const {
  removePublishedGranule,
} = require('@cumulus/api-client/granules');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  buildAndStartWorkflow,
} = require('../../helpers/workflowUtils');
const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
} = require('../../helpers/testUtils');
const { setDistributionApiEnvVars } = require('../../helpers/apiUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection,
} = require('../../helpers/granuleUtils');

const workflowName = 'IngestAndPublishGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

function failOnSetupError(setupErrors) {
  const errors = setupErrors.filter((e) => e);

  if (errors.length > 0) {
    console.log('Test setup failed, aborting');
    console.log(errors);
    fail(errors[0]);
  }
}

describe('The Ingest Granules workflow with duplicates in the payload and uniquification enabled', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranuleWithDuplicate.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
  const collectionDupeHandling = 'error';

  let beforeAllError;
  let collection;
  let collectionId;
  let config;
  let expectedPayload;
  let expectedS3TagSet;
  let expectedSyncGranulePayload;
  // let granuleCompletedMessageKey;
  // let granuleRunningMessageKey;
  let inputPayload;
  let pdrFilename;
  let provider;
  let testDataFolder;
  let workflowExecutionArn;
  const granuleWasDeleted = false;
  let reingestExecutionArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      const testId = createTimestampedTestId(config.stackName, 'IngestGranuleSuccess');
      const testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      collectionId = constructCollectionId(collection.name, collection.version);
      provider = { id: `s3_provider${testSuffix}` };

      process.env.system_bucket = config.bucket;

      const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
      const providerData = {
        ...providerJson,
        id: provider.id,
        host: config.bucket,
      };

      // populate collections, providers and test data
      await Promise.all([
        uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId, collectionDupeHandling),
        apiTestUtils.addProviderApi({ prefix: config.stackName, provider: providerData }),
      ]);

      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');

      // update test data filepaths
      inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
      pdrFilename = inputPayload.pdr.name;
      const granuleId = inputPayload.granules[0].granuleId;
      expectedS3TagSet = [{ Key: 'granuleId', Value: granuleId }];
      await Promise.all(inputPayload.granules[0].files.map((fileToTag) =>
        s3().putObjectTagging({ Bucket: config.bucket, Key: `${fileToTag.path}/${fileToTag.name}`, Tagging: { TagSet: expectedS3TagSet } })));

      const templatedSyncGranuleFilename = templateFile({
        inputTemplateFilename: './spec/parallel/ingestGranule/SyncGranule.output.payload.template.json',
        config: {
          granules: [
            {
              files: [
                {
                  bucket: config.buckets.internal.name,
                  key: `file-staging/${config.stackName}/replace-me-collectionId/replace-me-hashedGranuleId/replace-me-granuleId.hdf`,
                },
                {
                  bucket: config.buckets.internal.name,
                  key: `file-staging/${config.stackName}/replace-me-collectionId/replace-me-hashedGranuleId/replace-me-granuleId.hdf.met`,
                },
                {
                  bucket: config.buckets.internal.name,
                  key: `file-staging/${config.stackName}/replace-me-collectionId/replace-me-hashedGranuleId/replace-me-granuleId_ndvi.jpg`,
                },
              ],
            },
          ],
        },
      });

      expectedSyncGranulePayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedSyncGranuleFilename, granuleId, testDataFolder, collectionId, config.stackName);

      expectedSyncGranulePayload.granules[0].dataType += testSuffix;
      expectedSyncGranulePayload.granules[0].files[0].checksumType = inputPayload.granules[0].files[0].checksumType;
      expectedSyncGranulePayload.granules[0].files[0].checksum = inputPayload.granules[0].files[0].checksum;
      expectedSyncGranulePayload.granules[0].files[1].checksumType = inputPayload.granules[0].files[1].checksumType;
      expectedSyncGranulePayload.granules[0].files[1].checksum = inputPayload.granules[0].files[1].checksum;
      expectedSyncGranulePayload.granules[0].files[2].checksumType = inputPayload.granules[0].files[2].checksumType;
      expectedSyncGranulePayload.granules[0].files[2].checksum = inputPayload.granules[0].files[2].checksum;

      const templatedOutputPayloadFilename = templateFile({
        inputTemplateFilename: './spec/parallel/ingestGranule/IngestGranule.output.payload.template.json',
        config: {
          granules: [
            {
              files: [
                {
                  bucket: config.buckets.protected.name,
                  key: `MOD09GQ___006/2017/MOD/${testId}/replace-me-granuleId.hdf`,
                },
                {
                  bucket: config.buckets.private.name,
                  key: `MOD09GQ___006/MOD/${testId}/replace-me-granuleId.hdf.met`,
                },
                {
                  bucket: config.buckets.public.name,
                  key: `MOD09GQ___006/MOD/${testId}/replace-me-granuleId_ndvi.jpg`,
                },
                {
                  bucket: config.buckets['protected-2'].name,
                  key: `MOD09GQ___006/MOD/${testId}/replace-me-granuleId.cmr.xml`,
                },
              ],
            },
          ],
        },
      });

      expectedPayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedOutputPayloadFilename, granuleId, testDataFolder, collectionId);
      expectedPayload.granules[0].dataType += testSuffix;

      // process.env.DISTRIBUTION_ENDPOINT needs to be set for below
      setDistributionApiEnvVars();
      collectionId = constructCollectionId(collection.name, collection.version);

      console.log('Start SuccessExecution');
      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        {
          distribution_endpoint: process.env.DISTRIBUTION_ENDPOINT,
          uniquifyGranuleId: true,
        }
      );
    } catch (error) {
      beforeAllError = error;
    }
  });

  afterAll(async () => {
    // granule may already have been deleted by
    // granule deletion spec. but in case that spec
    // wasn't reached, make sure granule is deleted
    if (!granuleWasDeleted) {
      try {
        await removePublishedGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId,
          collectionId,
        });
      } catch (error) {
        if (error.statusCode !== 404 &&
          // remove from CMR throws a 400 when granule is missing
          (error.statusCode !== 400 && !error.apiMessage.includes('No record found'))) {
          throw error;
        }
      }
    }
    await apiTestUtils.deletePdr({
      prefix: config.stackName,
      pdr: pdrFilename,
    });

    // clean up stack state added by test
    await providersApi.deleteProvider({
      prefix: config.stackName,
      providerId: provider.id,
    });
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecutionArn });
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      deleteCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
      // TODO: uncomment to clean up once used
      // deleteS3Object(config.bucket, granuleCompletedMessageKey),
      // deleteS3Object(config.bucket, granuleRunningMessageKey),
    ]);
  });

  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });

  it('prepares the test suite successfully', () => {
    failOnSetupError([beforeAllError]);
  });

  xit('completes execution with success status', async () => {
    failOnSetupError([beforeAllError]);
    const workflowExecutionStatus = await waitForCompletedExecution(workflowExecutionArn);
    expect(workflowExecutionStatus).toEqual('SUCCEEDED');
  });

  xit('makes the granule available through the Cumulus API', () => {
    expect(true).toEqual(true);
  });

  describe('the SyncGranules task', () => {
    xit('updates the meta object with input_granules', () => {
      expect(true).toEqual(true);
    });
  });

  describe('the PostToCmr task', () => {
    xit('publishes the granule metadata to CMR', () => {
      expect(true).toEqual(true);
    });
  });

  describe('The Cumulus API', () => {
    xit('makes the granule available through the Cumulus API', () => {
      expect(true).toEqual(true);
    });
  });

  describe('when moving a granule', () => {
    xit('rejects moving a granule to a location that already exists', () => {
      expect(true).toEqual(true);
    });
    xit('when the file is deleted and the move retried, the move completes successfully', () => {
      expect(true).toEqual(true);
    });
  });

  describe('Granule files already exists in different collection', () => {
    xit('fails ingest', () => {
      expect(true).toEqual(true);
    });
    xit('does not overwrite files', () => {
      expect(true).toEqual(true);
    });
  });

  describe('Granule files already exists in same collection', () => {
    xit('fails ingest', () => {
      expect(true).toEqual(true);
    });
    xit('does not overwrite files', () => {
      expect(true).toEqual(true);
    });
  });

  describe('Granule with same producerGranuleId exists in the same collection', () => {
    describe('When set to "error"', () => {
      xit('fails ingest', () => {
        expect(true).toEqual(true);
      });
      xit('does not overwrite files', () => {
        expect(true).toEqual(true);
      });
    });
    describe('When set to "skip"', () => {
      xit('ingest succeeds', () => {
        expect(true).toEqual(true);
      });
      xit('does not ingest the duplicate', () => {
        expect(true).toEqual(true);
      });
      xit('does not overwrite files', () => {
        expect(true).toEqual(true);
      });
    });
    describe('When set to "replace"', () => {
      xit('ingest succeeds', () => {
        expect(true).toEqual(true);
      });
      xit('does ingest the duplicate', () => {
        expect(true).toEqual(true);
      });
      xit('does overwrite files', () => {
        expect(true).toEqual(true);
      });
    });
    describe('When set to "version"', () => {
      xit('ingest succeeds', () => {
        expect(true).toEqual(true);
      });
      xit('does ingest the duplicate', () => {
        expect(true).toEqual(true);
      });
      xit('does not overwrite files', () => {
        expect(true).toEqual(true);
      });
      // TODO what is 'hides'?
      xit('hides the previous granule', () => {
        expect(true).toEqual(true);
      });
    });
  });
});
