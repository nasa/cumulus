'use strict';

const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { URL, resolve } = require('url');

const difference = require('lodash/difference');

const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution, getExecution } = require('@cumulus/api-client/executions');
const { listGranules, reingestGranule, removePublishedGranule } = require('@cumulus/api-client/granules');
const { getPdr } = require('@cumulus/api-client/pdrs');
const providersApi = require('@cumulus/api-client/providers');

const { s3GetObjectTagging, s3ObjectExists } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  addCollections,
  conceptExists,
  getCmrMetadata,
  waitForCompletedExecution,
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');
const apiTestUtils = require('@cumulus/integration-tests/api/api');
const {
  getDistributionFileUrl,
  getTEADistributionApiFileStream,
  getTEADistributionApiRedirect,
  getTEARequestHeaders,
} = require('@cumulus/integration-tests/api/distribution');
const { waitForListGranulesResult } = require('@cumulus/integration-tests/Granules');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');

const { setDistributionApiEnvVars, waitForApiStatus } = require('../../helpers/apiUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection,
} = require('../../helpers/granuleUtils');
const {
  createTestDataPath,
  createTestSuffix,
  createTimestampedTestId,
  deleteFolder,
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
} = require('../../helpers/testUtils');
const {
  buildAndStartWorkflow,
  isReingestExecutionForGranuleId,
} = require('../../helpers/workflowUtils');

const lambdaStep = new LambdaStep();
const workflowName = 'IngestAndPublishGranuleUnique';

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

describe('The S3 Ingest Granules workflow with uniquification enabled', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest_unique';
  const collectionDupeHandling = 'error';

  let beforeAllError;
  let collection;
  let collectionId;
  let config;
  let expectedPayload;
  let expectedS3TagSet;
  let expectedSyncGranulePayload;
  let granuleIngested;
  let inputPayload;
  let pdrFilename;
  let postToCmrOutput;
  let producerGranuleId; // this is the original granuleId from inputPayload
  let provider;
  let reingestExecutionArn;
  let testDataFolder;
  let uniquifiedGranuleId; // uniquifiedGranuleId generated in workflow task
  let workflowExecutionArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      const testId = createTimestampedTestId(config.stackName, 'IngestGranuleWithUniqueGranuleIds');
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
        }
      );
    } catch (error) {
      beforeAllError = error;
    }
  });

  afterAll(async () => {
    await removePublishedGranule({
      prefix: config.stackName,
      granuleId: uniquifiedGranuleId,
      collectionId,
    });

    await apiTestUtils.deletePdr({
      prefix: config.stackName,
      pdr: pdrFilename,
    });

    await deleteExecution({ prefix: config.stackName, executionArn: reingestExecutionArn });

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
    ]);
  });

  beforeEach(() => {
    failOnSetupError([beforeAllError]);
  });

  it('prepares the test suite successfully', () => {
    failOnSetupError([beforeAllError]);
  });

  it('completes execution with success status', async () => {
    const workflowExecutionStatus = await waitForCompletedExecution(workflowExecutionArn);
    expect(workflowExecutionStatus).toEqual('SUCCEEDED');
  });

  it('triggers a running execution record being added to the PostgreSQL database', async () => {
    const record = await waitForApiStatus(
      getExecution,
      {
        prefix: config.stackName,
        arn: workflowExecutionArn,
      },
      ['running', 'completed']
    );
    expect(['running', 'completed'].includes(record.status)).toBeTrue();
  });

  it('triggers a running PDR record being added to the PostgreSQL database', async () => {
    const record = await waitForApiStatus(
      getPdr,
      {
        prefix: config.stackName,
        pdrName: inputPayload.pdr.name,
      },
      ['running', 'completed']
    );
    expect(['running', 'completed'].includes(record.status)).toBeTrue();
  });

  it('ingests the uniquified granule with linked PDR', async () => {
    const searchResults = await waitForListGranulesResult({
      prefix: config.stackName,
      query: {
        producerGranuleId: inputPayload.granules[0].granuleId,
        collectionId,
        status: 'completed',
        includeFullRecord: 'true',
      },
    });

    const granules = JSON.parse(searchResults.body).results;
    expect(granules.length).toBe(1);
    expect(granules[0].producerGranuleId).toBe(inputPayload.granules[0].granuleId);
    expect(granules[0].status).toBe('completed');
    expect(granules[0].pdrName).toBe(inputPayload.pdr.name);
    granuleIngested = granules[0];
    console.log('granuleIngested:', granuleIngested);
    ({ producerGranuleId, granuleId: uniquifiedGranuleId } = granuleIngested);
    expect(uniquifiedGranuleId).not.toBe(producerGranuleId);
  });

  it('does not write the granule at workflow start', async () => {
    const searchResults = await listGranules({
      prefix: config.stackName,
      query: {
        granuleId: inputPayload.granules[0].granuleId,
        collectionId,
      },
    });
    const granules = JSON.parse(searchResults.body).results;
    expect(granules.length).toBe(0);
  });

  describe('GranuleStatusReport lambda function', () => {
    let lambdaOutput;
    let subTestSetupError;
    beforeAll(async () => {
      try {
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecutionArn, 'SfSqsReport');
      } catch (error) {
        subTestSetupError = error;
      }
    });

    it('has expected output', () => {
      failOnSetupError([beforeAllError, subTestSetupError]);
      const granule = lambdaOutput.payload.granules[0];
      expect(granule.granuleId).toEqual(uniquifiedGranuleId);
      expect(granule.producerGranuleId).toEqual(producerGranuleId);
    });
  });

  describe('the BackupGranulesToLzards task', () => {
    let lambdaOutput;
    let subTestSetupError;
    beforeAll(async () => {
      try {
        failOnSetupError([beforeAllError, subTestSetupError]);
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecutionArn, 'LzardsBackup');
      } catch (error) {
        subTestSetupError = error;
      }
    });

    beforeEach(() => {
      failOnSetupError([beforeAllError, subTestSetupError]);
    });

    it('adds LZARDS backup output', () => {
      const dataType = lambdaOutput.meta.input_granules[0].dataType;
      const version = lambdaOutput.meta.input_granules[0].version;
      const expectedCollectionId = constructCollectionId(dataType, version);
      expect(true, lambdaOutput.meta.backupStatus.every((file) => file.status === 'COMPLETED'));
      expect(lambdaOutput.meta.backupStatus[0].provider).toBe(provider.id);
      expect(lambdaOutput.meta.backupStatus[0].createdAt).toBe(lambdaOutput.meta.input_granules[0].createdAt);
      expect(lambdaOutput.meta.backupStatus[0].collectionId).toBe(expectedCollectionId);
      expect(lambdaOutput.meta.backupStatus[0].producerGranuleId).toBe(producerGranuleId);
      expect(lambdaOutput.meta.backupStatus[0].granuleId).toBe(uniquifiedGranuleId);
    });
  });

  describe('the SyncGranules task', () => {
    let lambdaInput;
    let lambdaOutput;
    let subTestSetupError;
    let updatedGranule;

    beforeAll(async () => {
      try {
        failOnSetupError([beforeAllError, subTestSetupError]);

        lambdaInput = await lambdaStep.getStepInput(workflowExecutionArn, 'SyncGranule');
        lambdaOutput = await lambdaStep.getStepOutput(workflowExecutionArn, 'SyncGranule');
        updatedGranule = {
          ...expectedSyncGranulePayload.granules[0],
          granuleId: uniquifiedGranuleId,
          sync_granule_duration: lambdaOutput.meta.input_granules[0].sync_granule_duration,
          createdAt: lambdaOutput.meta.input_granules[0].createdAt,
          producerGranuleId,
          provider: lambdaOutput.meta.input_granules[0].provider,
        };
      } catch (error) {
        beforeAllError = error;
      }
    });

    beforeEach(() => {
      failOnSetupError([beforeAllError, subTestSetupError]);
    });

    it('receives the correct collection and provider configuration', () => {
      expect(lambdaInput.meta.collection.name).toEqual(collection.name);
      expect(lambdaInput.meta.provider.id).toEqual(provider.id);
    });

    it('output includes the ingested granule with file staging location paths', () => {
      // update staging directory path with the hash on uniquifiedGranuleId instead of original granuleId
      const hashedGranuleId = crypto.createHash('md5').update(inputPayload.granules[0].granuleId).digest('hex');
      const hashedUniquifiedGranuleId = crypto.createHash('md5').update(uniquifiedGranuleId).digest('hex');
      expectedSyncGranulePayload.granules[0].files = expectedSyncGranulePayload.granules[0].files.map((file) => {
        file.key = file.key.replace(hashedGranuleId, hashedUniquifiedGranuleId);
        return file;
      });

      const updatedPayload = {
        ...expectedSyncGranulePayload,
        granules: [updatedGranule],
      };
      expect(lambdaOutput.payload).toEqual(updatedPayload);
    });

    it('updates the meta object with input_granules', () => {
      expect(lambdaOutput.meta.input_granules).toEqual([updatedGranule]);
    });

    it('sets granule.createdAt with value from SyncGranule', () => {
      expect(granuleIngested.granuleId).toEqual(lambdaOutput.meta.input_granules[0].granuleId);
      expect(granuleIngested.createdAt).toEqual(lambdaOutput.meta.input_granules[0].createdAt);
      expect(granuleIngested.createdAt).not.toEqual(undefined);
      expect(granuleIngested.producerGranuleId).toEqual(lambdaOutput.meta.input_granules[0].producerGranuleId);
      expect(granuleIngested.status).toEqual('completed');
    });
  });

  describe('the MoveGranules task', () => {
    let lambdaOutput;
    let files;
    let movedTaggings;
    let existCheck = [];
    let subTestSetupError;

    beforeAll(async () => {
      try {
        failOnSetupError([subTestSetupError]);

        lambdaOutput = await lambdaStep.getStepOutput(workflowExecutionArn, 'MoveGranules');
        files = lambdaOutput.payload.granules[0].files;
        movedTaggings = await Promise.all(lambdaOutput.payload.granules[0].files.map(
          (file) => s3GetObjectTagging(file.bucket, file.key)
        ));

        existCheck = await Promise.all([
          s3ObjectExists({ Bucket: files[0].bucket, Key: files[0].key }),
          s3ObjectExists({ Bucket: files[1].bucket, Key: files[1].key }),
          s3ObjectExists({ Bucket: files[2].bucket, Key: files[2].key }),
        ]);
      } catch (error) {
        subTestSetupError = error;
      }
    });

    beforeEach(() => {
      failOnSetupError([beforeAllError, subTestSetupError]);
    });

    it('has a payload with correct buckets, keys, sizes', () => {
      files.forEach((file) => {
        const expectedFile = expectedPayload.granules[0].files.find((f) => f.fileName === file.fileName);
        expect(file.key).toEqual(expectedFile.key);
        expect(file.bucket).toEqual(expectedFile.bucket);
        if (file.size && expectedFile.size) {
          expect(file.size).toEqual(expectedFile.size);
        }
      });
    });

    it('moves files to the bucket folder based on metadata', () => {
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
      });
    });

    it('preserves tags on moved files', () => {
      movedTaggings.forEach((tagging) => {
        expect(tagging.TagSet).toEqual(expectedS3TagSet);
      });
    });
  });

  describe('the PostToCmr task', () => {
    let metadataResults;
    let cmrResource;
    let ummCmrResource;
    let files;
    let granule;
    let opendapFilePath;
    let resourceURLs;
    let teaRequestHeaders;
    let scienceFileUrl;
    let s3ScienceFileUrl;
    let browseImageUrl;
    let s3BrowseImageUrl;
    let s3CredsUrl;

    let subTestSetupError;

    beforeAll(async () => {
      opendapFilePath = `https://opendap.uat.earthdata.nasa.gov/collections/C1218668453-CUMULUS/granules/${uniquifiedGranuleId}`;
      process.env.CMR_ENVIRONMENT = 'UAT';
      postToCmrOutput = await lambdaStep.getStepOutput(workflowExecutionArn, 'PostToCmr');

      if (postToCmrOutput === null) {
        beforeAllError = new Error(`Failed to get the PostToCmr step's output for ${workflowExecutionArn}`);
        return;
      }

      try {
        failOnSetupError([beforeAllError]);
        granule = postToCmrOutput.payload.granules[0];
        files = granule.files;

        const ummGranule = { ...granule, cmrMetadataFormat: 'umm_json_v1_6_2' };
        metadataResults = await Promise.all([
          getCmrMetadata(granule),
          getCmrMetadata(ummGranule),
          getTEARequestHeaders(config.stackName),
        ]);

        cmrResource = metadataResults[0].links;
        resourceURLs = cmrResource.map((resource) => resource.href);
        ummCmrResource = metadataResults[1].items.flatMap((item) => item.umm.RelatedUrls);
        teaRequestHeaders = metadataResults[2];

        scienceFileUrl = getDistributionFileUrl({ bucket: files[0].bucket, key: files[0].key });
        s3ScienceFileUrl = getDistributionFileUrl({ bucket: files[0].bucket, key: files[0].key, urlType: 's3' });
        browseImageUrl = getDistributionFileUrl({ bucket: files[2].bucket, key: files[2].key });
        s3BrowseImageUrl = getDistributionFileUrl({ bucket: files[2].bucket, key: files[2].key, urlType: 's3' });
        s3CredsUrl = resolve(process.env.DISTRIBUTION_ENDPOINT, 's3credentials');
      } catch (error) {
        subTestSetupError = error;
      }
    });

    beforeEach(() => {
      failOnSetupError([beforeAllError, subTestSetupError]);
    });

    it('publishes the granule metadata to CMR', async () => {
      const result = await conceptExists(granule.cmrLink);
      expect(granule.published).toEqual(true);
      expect(result).not.toEqual(false);
    });

    it('updates the CMR metadata with the expected producerGranuleId', () => {
      expect(metadataResults[1].items[0].umm.DataGranule.Identifiers[0].Identifier).toEqual(producerGranuleId);
      expect(metadataResults[1].items[0].umm.GranuleUR).toEqual(uniquifiedGranuleId);
    });

    it('updates the CMR metadata online resources with the final metadata location', () => {
      console.log('parallel resourceURLs:', resourceURLs);
      console.log('s3CredsUrl:', s3CredsUrl);

      expect(resourceURLs).toContain(scienceFileUrl);
      expect(resourceURLs).toContain(s3ScienceFileUrl);
      expect(resourceURLs).toContain(browseImageUrl);
      expect(resourceURLs).toContain(s3BrowseImageUrl);
      expect(resourceURLs).toContain(s3CredsUrl);
      expect(resourceURLs).toContain(opendapFilePath);
    });

    it('updates the CMR metadata "online resources" with the proper types and urls', () => {
      const resource = ummCmrResource;
      const expectedTypes = [
        'GET DATA',
        'GET DATA VIA DIRECT ACCESS',
        'VIEW RELATED INFORMATION',
        'VIEW RELATED INFORMATION',
        'GET RELATED VISUALIZATION',
        'GET RELATED VISUALIZATION',
        'VIEW RELATED INFORMATION',
        'USE SERVICE API',
      ];
      const cmrUrls = resource.map((r) => r.URL);

      expect(cmrUrls).toContain(scienceFileUrl);
      expect(cmrUrls).toContain(s3ScienceFileUrl);
      expect(cmrUrls).toContain(browseImageUrl);
      expect(cmrUrls).toContain(s3BrowseImageUrl);
      expect(cmrUrls).toContain(s3CredsUrl);
      expect(cmrUrls).toContain(opendapFilePath);
      expect(resource.map((r) => r.Type).sort()).toEqual(expectedTypes.sort());
    });

    it('includes the Earthdata login ID for requests to protected science files', async () => {
      const filepath = `/${files[0].bucket}/${files[0].key}`;
      const s3SignedUrl = await getTEADistributionApiRedirect(filepath, teaRequestHeaders);
      const earthdataLoginParam = new URL(s3SignedUrl).searchParams.get('A-userid');
      expect(earthdataLoginParam).toEqual(process.env.EARTHDATA_USERNAME);
    });

    it('downloads the requested science file for authorized requests', async () => {
      const scienceFileUrls = resourceURLs
        .filter((url) =>
          (url.startsWith(process.env.DISTRIBUTION_ENDPOINT) ||
            url.match(/s3\.amazonaws\.com/)) &&
          !url.endsWith('.cmr.xml') &&
          !url.includes('s3credentials'));

      const checkFiles = await Promise.all(
        scienceFileUrls
          .map(async (url) => {
            const extension = path.extname(new URL(url).pathname);
            const sourceFile = s3data.find((d) => d.endsWith(extension));
            const sourceChecksum = await generateChecksumFromStream(
              'cksum',
              fs.createReadStream(require.resolve(sourceFile))
            );
            const file = files.find((f) => f.fileName.endsWith(extension));

            const filepath = `/${file.bucket}/${file.key}`;
            const fileStream = await getTEADistributionApiFileStream(filepath, teaRequestHeaders);
            // Compare checksum of downloaded file with expected checksum.
            const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
            return downloadChecksum === sourceChecksum;
          })
      );

      checkFiles.forEach((fileCheck) => expect(fileCheck).toBeTrue());
    });
  });

  describe('when a reingest granule is triggered via the API', () => {
    let oldExecution;
    let oldUpdatedAt;
    let reingestResponse;

    beforeAll(async () => {
      oldUpdatedAt = granuleIngested.updatedAt;
      oldExecution = granuleIngested.execution;
      const reingestGranuleResponse = await reingestGranule({
        prefix: config.stackName,
        granuleId: uniquifiedGranuleId,
        collectionId,
      });
      reingestResponse = JSON.parse(reingestGranuleResponse.body);
    });

    it('submits request successfully', () => {
      expect(reingestResponse.status).toEqual('SUCCESS');
    });

    it('reingests granule successfully', async () => {
      // Await reingest completion
      const reingestGranuleExecution = await waitForTestExecutionStart({
        workflowName,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: isReingestExecutionForGranuleId,
        findExecutionFnParams: { granuleId: inputPayload.granules[0].granuleId },
        startTask: 'AddUniqueGranuleId',
      });

      reingestExecutionArn = reingestGranuleExecution.executionArn;

      console.log(`Wait for completed execution ${reingestExecutionArn}`);

      await waitForCompletedExecution(reingestExecutionArn);
    });

    it('overwrites the old granule', async () => {
      const searchResults = await waitForListGranulesResult({
        prefix: config.stackName,
        query: {
          producerGranuleId,
          collectionId,
          status: 'completed',
          includeFullRecord: 'true',
        },
      });

      const granules = JSON.parse(searchResults.body).results;
      expect(granules.length).toBe(1);
      const updatedGranule = granules[0];
      expect(updatedGranule.granuleId).toBe(uniquifiedGranuleId);
      expect(updatedGranule.producerGranuleId).toBe(producerGranuleId);
      expect(updatedGranule.status).toBe('completed');
      expect(updatedGranule.updatedAt).toBeGreaterThan(oldUpdatedAt);
      expect(updatedGranule.execution).not.toBe(oldExecution);

      // the updated granule has the same files
      const oldFileNames = granuleIngested.files.map((f) => f.filename);
      const newFileNames = updatedGranule.files.map((f) => f.filename);
      expect(difference(oldFileNames, newFileNames).length).toBe(0);
    });
  });
});
