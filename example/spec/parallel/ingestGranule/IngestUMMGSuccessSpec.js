'use strict';

const pRetry = require('p-retry');
const { get } = require('lodash/fp');
const fs = require('fs-extra');
const path = require('path');
const {
  URL,
  resolve,
} = require('url');
const mime = require('mime-types');

const {
  s3ObjectExists,
  parseS3Uri,
  headObject,
  buildS3Uri,
  getJsonS3Object,
} = require('@cumulus/aws-client/S3');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const {
  addCollections,
  conceptExists,
  getOnlineResources,
} = require('@cumulus/integration-tests');
const apiTestUtils = require('@cumulus/integration-tests/api/api');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { moveGranule, removePublishedGranule } = require('@cumulus/api-client/granules');
const providersApi = require('@cumulus/api-client/providers');
const {
  getDistributionFileUrl,
  getTEADistributionApiRedirect,
  getTEADistributionApiFileStream,
  getTEARequestHeaders,
} = require('@cumulus/integration-tests/api/distribution');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { encodedConstructCollectionId } = require('../../helpers/Collections');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  templateFile,
} = require('../../helpers/testUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  setDistributionApiEnvVars,
} = require('../../helpers/apiUtils');
const {
  addUniqueGranuleFilePathToGranuleFiles,
  addUrlPathToGranuleFiles,
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection,
} = require('../../helpers/granuleUtils');

const lambdaStep = new LambdaStep();
const workflowName = 'IngestAndPublishGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

const SetupError = new Error('Test setup failed, aborting');

async function getUmmObject(fileLocation) {
  const { Bucket, Key } = parseS3Uri(fileLocation);

  const ummFileJson = await getJsonS3Object(Bucket, Key);
  return ummFileJson;
}

const getOnlineResourcesWithRetries = async (granule) =>
  await pRetry(
    async () => {
      let onlineResources;

      try {
        onlineResources = await getOnlineResources(granule);
      } catch (error) {
        throw new pRetry.AbortError(error);
      }

      if (onlineResources.length === 0) {
        throw new Error('No online resources found');
      }

      return onlineResources;
    },
    { retries: 60, maxTimeout: 5000, factor: 1.05 }
  );

const cumulusDocUrl = 'https://nasa.github.io/cumulus/docs/cumulus-docs-readme';
const isUMMGScienceUrl = (url) => url !== cumulusDocUrl &&
  !url.endsWith('.cmr.json') &&
  !url.includes('s3credentials') &&
  !url.includes('opendap.uat.earthdata.nasa.gov');

describe('The S3 Ingest Granules workflow configured to ingest UMM-G', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006-umm';

  let workflowExecution;
  let inputPayload;
  let expectedPayload;
  let pdrFilename;
  let postToCmrOutput;
  let granule;
  let config;
  let testDataFolder;
  let collection;
  let provider;

  let beforeAllError = false;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      const testId = createTimestampedTestId(config.stackName, 'IngestUMMGSuccess');
      const testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      provider = { id: `s3_provider${testSuffix}` };
      const newCollectionId = encodedConstructCollectionId(collection.name, collection.version);

      process.env.system_bucket = config.bucket;

      const collectionUrlPath = '{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{substring(file.fileName, 0, 3)}/';
      const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
      const providerData = {
        ...providerJson,
        id: provider.id,
        host: config.bucket,
      };
      // populate collections, providers and test data
      await Promise.all([
        uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
        apiTestUtils.addProviderApi({ prefix: config.stackName, provider: providerData }),
      ]);

      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      // update test data filepaths
      inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
      pdrFilename = inputPayload.pdr.name;
      const granuleId = inputPayload.granules[0].granuleId;

      const templatedOutputPayloadFilename = templateFile({
        inputTemplateFilename: './spec/parallel/ingestGranule/IngestGranule.UMM.output.payload.template.json',
        config: {
          granules: [
            {
              files: [
                {
                  bucket: config.buckets.protected.name,
                  key: `MOD09GQ___006/2016/MOD/${testId}/replace-me-granuleId.hdf`,
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
                  key: `MOD09GQ___006/MOD/${testId}/replace-me-granuleId.cmr.json`,
                },
              ],
            },
          ],
        },
      });

      expectedPayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedOutputPayloadFilename, granuleId, testDataFolder, newCollectionId);
      expectedPayload.granules[0].dataType += testSuffix;
      expectedPayload.granules = addUniqueGranuleFilePathToGranuleFiles(expectedPayload.granules, testId);
      expectedPayload.granules[0].files = addUrlPathToGranuleFiles(expectedPayload.granules[0].files, testId, collectionUrlPath);

      // process.env.DISTRIBUTION_ENDPOINT needs to be set for below
      setDistributionApiEnvVars();

      // s3 link type 'GET DATA VIA DIRECT ACCESS' isn't valid until UMM-G version 1.6.2
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        {
          cmrMetadataFormat: 'umm_json_v1_6_2',
          additionalUrls: [cumulusDocUrl],
          distribution_endpoint: process.env.DISTRIBUTION_ENDPOINT,
        }
      );
    } catch (error) {
      beforeAllError = error;
    }
  });

  afterAll(async () => {
    // clean up stack state added by test
    await removePublishedGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId,
      collectionId: encodedConstructCollectionId(collection.name, collection.version),
    });
    await apiTestUtils.deletePdr({
      prefix: config.stackName,
      pdr: pdrFilename,
    });
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      deleteCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
      providersApi.deleteProvider({
        prefix: config.stackName,
        providerId: provider.id,
      }),
    ]);
  });

  it('completes execution with success status', () => {
    if (beforeAllError) throw beforeAllError;
    expect(workflowExecution.status).toEqual('completed');
  });

  // This is a sanity check to make sure we actually generated UMM and also
  // grab the location of the UMM file to use when testing move
  describe('the processing task creates a UMM file', () => {
    let processingTaskOutput;
    let ummFiles;
    let subTestSetupError;

    beforeAll(async () => {
      try {
        processingTaskOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'FakeProcessing');
        ummFiles = processingTaskOutput.payload.filter((file) => file.includes('.cmr.json'));
      } catch (error) {
        subTestSetupError = error;
        throw error;
      }
    });

    beforeEach(() => {
      if (beforeAllError) fail(beforeAllError);
      if (subTestSetupError) fail(subTestSetupError);
    });

    it('creates a UMM JSON file', () => {
      if (beforeAllError || subTestSetupError) throw SetupError;
      expect(ummFiles.length).toEqual(1);
    });

    it('does not create a CMR XML file', () => {
      if (beforeAllError || subTestSetupError) throw SetupError;
      const xmlFiles = processingTaskOutput.payload.filter((file) => file.includes('.cmr.xml'));
      expect(xmlFiles.length).toEqual(0);
    });
  });

  describe('the MoveGranules task', () => {
    let moveGranulesTaskOutput;
    let headObjects;
    let movedFiles;
    let subTestSetupError;
    let existCheck = [];

    beforeAll(async () => {
      try {
        moveGranulesTaskOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
        movedFiles = moveGranulesTaskOutput.payload.granules[0].files;
        existCheck = await Promise.all(movedFiles.map((fileObject) =>
          s3ObjectExists({ Bucket: fileObject.bucket, Key: fileObject.key })));
        headObjects = await Promise.all(movedFiles.map(async (fileObject) =>
          ({
            ...fileObject,
            ...await headObject(fileObject.bucket, fileObject.key),
            expectedMime: mime.lookup(fileObject.key) || 'application/octet-stream',
          })));
      } catch (error) {
        subTestSetupError = error;
        throw error;
      }
    });

    beforeEach(() => {
      if (beforeAllError) fail(beforeAllError);
      if (subTestSetupError) fail(subTestSetupError);
    });

    it('has a payload with correct buckets, keys, sizes', () => {
      if (beforeAllError || subTestSetupError) throw SetupError;
      movedFiles.forEach((file) => {
        const expectedFile = expectedPayload.granules[0].files.find((f) => f.fileName === file.fileName);
        expect(file.key).toEqual(expectedFile.key);
        expect(file.bucket).toEqual(expectedFile.bucket);
        if (file.size && expectedFile.size) {
          expect(file.size).toEqual(expectedFile.size);
        }
      });
    });

    it('has expected ContentType values in s3', () => {
      if (beforeAllError || subTestSetupError) throw SetupError;
      headObjects.forEach((headObj) => expect(headObj.ContentType).toEqual(headObj.expectedMime));
    });

    it('moves files to the bucket folder based on metadata', () => {
      if (beforeAllError || subTestSetupError) throw SetupError;
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
      });
    });
  });

  describe('When moving a granule via the Cumulus API', () => {
    let file;
    let destinationKey;
    let destinations;
    let originalUmmUrls;
    let newS3UMMJsonFileLocation;
    let subTestSetupError;

    beforeAll(async () => {
      try {
        file = granule.files[0];

        const ummGJsonFile = expectedPayload.granules[0].files.find((f) => f.fileName.includes('.cmr.json'));
        newS3UMMJsonFileLocation = buildS3Uri(ummGJsonFile.bucket, ummGJsonFile.key);

        destinationKey = `${testDataFolder}/${file.key}`;
        destinations = [{
          regex: '.*.hdf$',
          bucket: config.buckets.protected.name,
          filepath: `${testDataFolder}/${path.dirname(file.key)}`,
        }];

        const originalUmm = await getUmmObject(newS3UMMJsonFileLocation);
        originalUmmUrls = originalUmm.RelatedUrls.map((urlObject) => urlObject.URL);
      } catch (error) {
        subTestSetupError = error;
      }
    });

    beforeEach(() => {
      if (beforeAllError) fail(beforeAllError);
      if (subTestSetupError) fail(subTestSetupError);
    });

    it('returns success upon move', async () => {
      if (beforeAllError || subTestSetupError) throw SetupError;
      const moveGranuleResponse = await moveGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId: encodedConstructCollectionId(collection.name, collection.version),
        destinations,
      });

      expect(moveGranuleResponse.statusCode).toEqual(200);
    });

    it('updates the UMM-G JSON file in S3 with new paths', async () => {
      if (beforeAllError || subTestSetupError) throw SetupError;
      const updatedUmm = await getUmmObject(newS3UMMJsonFileLocation);

      const changedUrls = updatedUmm.RelatedUrls
        .filter((urlObject) => urlObject.URL.endsWith('.hdf'))
        .map((urlObject) => urlObject.URL);
      const unchangedUrls = updatedUmm.RelatedUrls
        .filter((urlObject) => !urlObject.URL.endsWith('.hdf'))
        .map((urlObject) => urlObject.URL);

      // Only the file that was moved was updated
      expect(changedUrls.length).toEqual(2);
      changedUrls.forEach((changedUrl) => expect(changedUrl).toContain(destinationKey));

      const unchangedOriginalUrls = originalUmmUrls.filter((original) => !original.endsWith('.hdf'));
      expect(unchangedOriginalUrls.length).toEqual(unchangedUrls.length);

      // Each originalUmmUrl (removing the DISTRIBUTION_ENDPOINT) should be found
      // in one of the updated URLs. We have to do this comparison because the
      // setup tests uses a fake endpoint, but it's possible that the api has
      // the actual endpoint.
      unchangedOriginalUrls.forEach((original) => {
        if (original.startsWith('s3://')) {
          expect(unchangedUrls.filter((actual) => actual === original).length).toBe(1);
        } else {
          const base = original.replace(process.env.DISTRIBUTION_ENDPOINT, '');
          expect(
            unchangedUrls.filter((actual) => !actual.startsWith('s3://') && actual.match(base)).length
          ).toBe(1);
        }
      });
    });
  });
});
