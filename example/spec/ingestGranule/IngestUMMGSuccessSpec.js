'use strict';

const fs = require('fs-extra');
const got = require('got');
const path = require('path');
const {
  URL,
  resolve
} = require('url');
const cloneDeep = require('lodash.clonedeep');

const {
  models: {
    AccessToken, Execution, Collection, Provider
  }
} = require('@cumulus/api');
const { serveDistributionApi } = require('@cumulus/api/bin/serve');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const {
  aws: {
    getS3Object,
    s3ObjectExists,
    parseS3Uri
  },
  BucketsConfig,
  constructCollectionId
} = require('@cumulus/common');
const { getUrl } = require('@cumulus/cmrjs');
const {
  api: apiTestUtils,
  buildAndExecuteWorkflow,
  LambdaStep,
  conceptExists,
  getOnlineResources,
  granulesApi: granulesApiTestUtils,
  EarthdataLogin: { getEarthdataAccessToken },
  distributionApi: {
    getDistributionApiS3SignedUrl,
    getDistributionApiFileStream,
    getDistributionFileUrl
  }
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  templateFile,
  getPublicS3FileUrl
} = require('../helpers/testUtils');
const {
  setDistributionApiEnvVars,
  stopDistributionApi
} = require('../helpers/apiUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection
} = require('../helpers/granuleUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();
const workflowName = 'IngestAndPublishGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: './spec/ingestGranule/IngestGranule.UMM.output.payload.template.json',
  config: config[workflowName].IngestUMMGranuleOutput
});

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

async function getUmmObject(fileLocation) {
  const { Bucket, Key } = parseS3Uri(fileLocation);

  const ummFile = await getS3Object(Bucket, Key);
  return JSON.parse(ummFile.Body.toString());
}

const cumulusDocUrl = 'https://nasa.github.io/cumulus/docs/cumulus-docs-readme';
const isUMMGScienceUrl = (url) => url !== cumulusDocUrl &&
  !url.endsWith('.cmr.json') &&
  !url.includes('s3credentials');

describe('The S3 Ingest Granules workflow configured to ingest UMM-G', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestUMMGSuccess');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006-umm';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };
  const newCollectionId = constructCollectionId(collection.name, collection.version);

  let workflowExecution = null;
  let inputPayload;
  let expectedPayload;
  let postToCmrOutput;
  let granule;
  let server;

  process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
  const accessTokensModel = new AccessToken();
  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const executionModel = new Execution();
  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();
  process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
  const providerModel = new Provider();

  beforeAll(async (done) => {
    const collectionJson = JSON.parse(fs.readFileSync(`${collectionsDir}/s3_MOD09GQ_006.json`, 'utf8'));
    collectionJson.duplicateHandling = 'error';
    const collectionData = Object.assign({}, collectionJson, {
      name: collection.name,
      dataType: collectionJson.dataType + testSuffix
    });

    const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
    const providerData = Object.assign({}, providerJson, {
      id: provider.id,
      host: config.bucket
    });

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      apiTestUtils.addCollectionApi({ prefix: config.stackName, collection: collectionData }),
      apiTestUtils.addProviderApi({ prefix: config.stackName, provider: providerData })
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    const granuleId = inputPayload.granules[0].granuleId;

    expectedPayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedOutputPayloadFilename, granuleId, testDataFolder, newCollectionId);
    expectedPayload.granules[0].dataType += testSuffix;

    // process.env.DISTRIBUTION_ENDPOINT needs to be set for below
    setDistributionApiEnvVars();

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      inputPayload,
      {
        cmrMetadataFormat: 'umm_json_v1_5',
        additionalUrls: [cumulusDocUrl],
        distribution_endpoint: process.env.DISTRIBUTION_ENDPOINT
      }
    );

    // Use done() to signal end of beforeAll() after distribution API has started up
    server = await serveDistributionApi(config.stackName, done);
  });

  afterAll(async (done) => {
    try {
      // clean up stack state added by test
      await Promise.all([
        deleteFolder(config.bucket, testDataFolder),
        collectionModel.delete(collection),
        providerModel.delete(provider),
        executionModel.delete({ arn: workflowExecution.executionArn }),
        granulesApiTestUtils.removePublishedGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        })
      ]);
      stopDistributionApi(server, done);
    }
    catch (err) {
      stopDistributionApi(server, done);
    }
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  // This is a sanity check to make sure we actually generated UMM and also
  // grab the location of the UMM file to use when testing move
  describe('the processing task creates a UMM file', () => {
    let processingTaskOutput;
    let ummFiles;

    beforeAll(async () => {
      processingTaskOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'FakeProcessing');
      ummFiles = processingTaskOutput.payload.filter((file) => file.includes('.cmr.json'));
    });

    it('creates a UMM JSON file', () => {
      expect(ummFiles.length).toEqual(1);
    });

    it('does not create a CMR XML file', () => {
      const xmlFiles = processingTaskOutput.payload.filter((file) => file.includes('.cmr.xml'));
      expect(xmlFiles.length).toEqual(0);
    });
  });

  describe('the MoveGranules task', () => {
    let moveGranulesTaskOutput;
    let movedFiles;
    let existCheck = [];

    beforeAll(async () => {
      moveGranulesTaskOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      movedFiles = moveGranulesTaskOutput.payload.granules[0].files;
      existCheck = await Promise.all([
        s3ObjectExists({ Bucket: movedFiles[0].bucket, Key: movedFiles[0].filepath }),
        s3ObjectExists({ Bucket: movedFiles[1].bucket, Key: movedFiles[1].filepath }),
        s3ObjectExists({ Bucket: movedFiles[2].bucket, Key: movedFiles[2].filepath })
      ]);
    });

    it('has a payload with correct buckets, filenames, filesizes', () => {
      movedFiles.forEach((file) => {
        const expectedFile = expectedPayload.granules[0].files.find((f) => f.name === file.name);
        expect(file.filename).toEqual(expectedFile.filename);
        expect(file.bucket).toEqual(expectedFile.bucket);
        if (file.fileSize) {
          expect(file.fileSize).toEqual(expectedFile.fileSize);
        }
      });
    });

    it('moves files to the bucket folder based on metadata', () => {
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
      });
    });
  });

  describe('the PostToCmr task', () => {
    let bucketsConfig;
    let onlineResources;
    let files;
    let resourceURLs;
    let accessToken;

    beforeAll(async () => {
      bucketsConfig = new BucketsConfig(config.buckets);

      postToCmrOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
      if (postToCmrOutput === null) throw new Error(`Failed to get the PostToCmr step's output for ${workflowExecution.executionArn}`);

      granule = postToCmrOutput.payload.granules[0];
      files = granule.files;

      const result = await Promise.all([
        getOnlineResources(granule),
        // Login with Earthdata and get access token.
        getEarthdataAccessToken({
          redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
          requestOrigin: process.env.DISTRIBUTION_ENDPOINT
        })
      ]);

      onlineResources = result[0];
      resourceURLs = onlineResources.map((resource) => resource.URL);

      const accessTokenResponse = result[1];
      accessToken = accessTokenResponse.accessToken;
    });

    afterAll(async () => {
      await accessTokensModel.delete({ accessToken });
    });

    it('has expected payload', () => {
      expect(granule.published).toBe(true);
      expect(granule.cmrLink).toEqual(`${getUrl('search')}granules.json?concept_id=${granule.cmrConceptId}`);

      // Set the expected CMR values since they're going to be different
      // every time this is run.
      const updatedExpectedPayload = cloneDeep(expectedPayload);
      updatedExpectedPayload.granules[0].cmrLink = granule.cmrLink;
      updatedExpectedPayload.granules[0].cmrConceptId = granule.cmrConceptId;

      expect(postToCmrOutput.payload).toEqual(updatedExpectedPayload);
    });

    it('publishes the granule metadata to CMR', async () => {
      const result = await conceptExists(granule.cmrLink, true);

      expect(granule.published).toEqual(true);
      expect(result).not.toEqual(false);
    });

    it('updates the CMR metadata online resources with the final metadata location', () => {
      const distributionUrl = getDistributionFileUrl({
        bucket: files[0].bucket,
        key: files[0].filepath
      });
      const s3Url = getPublicS3FileUrl({ bucket: files[2].bucket, key: files[2].filepath });

      expect(resourceURLs.includes(distributionUrl)).toBe(true);
      expect(resourceURLs.includes(s3Url)).toBe(true);
    });

    it('publishes CMR metadata online resources with the correct type', () => {
      const viewRelatedInfoResource = onlineResources.filter((resource) => resource.Type === 'VIEW RELATED INFORMATION');
      const s3CredsUrl = resolve(process.env.DISTRIBUTION_ENDPOINT, 's3credentials');

      const ExpectedResources = ['GET DATA', 'GET DATA', 'GET RELATED VISUALIZATION',
        'EXTENDED METADATA', 'VIEW RELATED INFORMATION'].sort();
      expect(viewRelatedInfoResource.map((urlObj) => urlObj.URL).includes(s3CredsUrl)).toBe(true);
      expect(onlineResources.map((x) => x.Type).sort()).toEqual(ExpectedResources);
    });

    it('updates the CMR metadata online resources with s3credentials location', () => {
      const s3CredentialsURL = resolve(process.env.DISTRIBUTION_ENDPOINT, 's3credentials');
      console.log(`resourceURLs: ${resourceURLs}`);
      expect(resourceURLs.includes(s3CredentialsURL)).toBe(true);
    });

    it('does not overwrite the original related url', () => {
      expect(resourceURLs.includes(cumulusDocUrl)).toBe(true);
    });

    it('includes the Earthdata login ID for requests to protected science files', async () => {
      const distributionUrl = getDistributionFileUrl({
        bucket: files[0].bucket,
        key: files[0].filepath
      });
      const s3SignedUrl = await getDistributionApiS3SignedUrl(distributionUrl, accessToken);
      const earthdataLoginParam = new URL(s3SignedUrl).searchParams.get('x-EarthdataLoginUsername');
      expect(earthdataLoginParam).toEqual(process.env.EARTHDATA_USERNAME);
    });

    it('downloads the requested science file for authorized requests', async () => {
      const scienceFileUrls = resourceURLs.filter(isUMMGScienceUrl);
      console.log('scienceFileUrls: ', scienceFileUrls);

      const checkFiles = await Promise.all(
        scienceFileUrls
          .map(async (url) => {
            const extension = path.extname(new URL(url).pathname);
            const sourceFile = s3data.find((d) => d.endsWith(extension));
            const sourceChecksum = await generateChecksumFromStream(
              'cksum',
              fs.createReadStream(require.resolve(sourceFile))
            );
            const file = files.find((f) => f.name.endsWith(extension));

            let fileStream;

            if (bucketsConfig.type(file.bucket) === 'protected') {
              const fileUrl = getDistributionFileUrl({
                bucket: file.bucket,
                key: file.filepath
              });
              fileStream = await getDistributionApiFileStream(fileUrl, accessToken);
            }
            else if (bucketsConfig.type(file.bucket) === 'public') {
              fileStream = got.stream(url);
            }

            // Compare checksum of downloaded file with expected checksum.
            const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
            return downloadChecksum === sourceChecksum;
          })
      );

      checkFiles.forEach((fileCheck) => {
        expect(fileCheck).toBe(true);
      });
    });
  });

  describe('When moving a granule via the Cumulus API', () => {
    let file;
    let destinationKey;
    let destinations;
    let originalUmmUrls;
    let newS3UMMJsonFileLocation;

    beforeAll(async () => {
      file = granule.files[0];

      newS3UMMJsonFileLocation = expectedPayload.granules[0].files.find((f) => f.filename.includes('.cmr.json')).filename;

      destinationKey = `${testDataFolder}/${file.filepath}`;

      destinations = [{
        regex: '.*.hdf$',
        bucket: config.buckets.protected.name,
        filepath: `${testDataFolder}/${path.dirname(file.filepath)}`
      }];

      const originalUmm = await getUmmObject(newS3UMMJsonFileLocation);
      originalUmmUrls = originalUmm.RelatedUrls.map((urlObject) => urlObject.URL);
    });

    it('returns success upon move', async () => {
      const moveGranuleResponse = await granulesApiTestUtils.moveGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
        destinations
      });

      expect(moveGranuleResponse.statusCode).toEqual(200);
    });

    it('updates the UMM-G JSON file in S3 with new paths', async () => {
      const updatedUmm = await getUmmObject(newS3UMMJsonFileLocation);

      const relatedUrlDifferences = updatedUmm.RelatedUrls.filter((urlObject) => {
        // Skip non-science URLs and public S3 URLs
        if (!isUMMGScienceUrl(urlObject.URL) ||
            urlObject.URL.match(/s3\.amazonaws\.com/)) {
          return false;
        }
        const relatedUrl = new URL(urlObject.URL);
        relatedUrl.host = process.env.DISTRIBUTION_ENDPOINT;
        return !originalUmmUrls.includes(relatedUrl.toString());
      });

      // Only the file that was moved was updated
      expect(relatedUrlDifferences.length).toEqual(1);

      expect(relatedUrlDifferences[0].URL).toContain(destinationKey);
    });
  });
});
