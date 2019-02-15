'use strict';

const fs = require('fs-extra');
const urljoin = require('url-join');
const got = require('got');
const path = require('path');
const cloneDeep = require('lodash.clonedeep');
const differenceWith = require('lodash.differencewith');
const isEqual = require('lodash.isequal');
const {
  models: {
    Execution, Collection, Provider
  }
} = require('@cumulus/api');
const {
  aws: {
    getS3Object,
    s3ObjectExists,
    parseS3Uri
  },
  constructCollectionId
} = require('@cumulus/common');
const {
  api: apiTestUtils,
  buildAndExecuteWorkflow,
  LambdaStep,
  conceptExists,
  getOnlineResources,
  granulesApi: granulesApiTestUtils
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  templateFile
} = require('../../helpers/testUtils');

const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection
} = require('../../helpers/granuleUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();
const workflowName = 'IngestAndPublishGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: './spec/parallel/ingestGranule/IngestGranule.UMM.output.payload.template.json',
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

describe('The S3 Ingest Granules workflow configured to ingest UMM-G', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleSuccess');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006-umm';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };
  const cumulusDocUrl = 'https://nasa.github.io/cumulus/docs/cumulus-docs-readme';
  const newCollectionId = constructCollectionId(collection.name, collection.version);
  let workflowExecution = null;
  let inputPayload;
  let expectedPayload;
  let postToCmrOutput;
  let granule;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const executionModel = new Execution();
  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();
  process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
  const providerModel = new Provider();

  beforeAll(async () => {
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

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      inputPayload,
      {
        cmrFileType: 'umm_json_v1_5',
        additionalUrls: [cumulusDocUrl]
      }
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      collectionModel.delete(collection),
      providerModel.delete(provider),
      executionModel.delete({ arn: workflowExecution.executionArn }),
      granulesApiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
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
    let cmrResource;
    let cmrLink;
    let response;
    let files;
    let resourceHrefs;

    beforeAll(async () => {
      postToCmrOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
      if (postToCmrOutput === null) throw new Error(`Failed to get the PostToCmr step's output for ${workflowExecution.executionArn}`);

      files = postToCmrOutput.payload.granules[0].files;
      cmrLink = postToCmrOutput.payload.granules[0].cmrLink;
      cmrResource = await getOnlineResources(cmrLink);
      response = await got(cmrResource[2].href);

      resourceHrefs = cmrResource.map((resource) => resource.href);
    });

    it('has expected payload', () => {
      granule = postToCmrOutput.payload.granules[0];
      expect(granule.published).toBe(true);
      expect(granule.cmrLink.startsWith('https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=')).toBe(true);

      // Set the expected cmrLink to the actual cmrLink, since it's going to
      // be different every time this is run.
      const updatedExpectedpayload = cloneDeep(expectedPayload);
      updatedExpectedpayload.granules[0].cmrLink = postToCmrOutput.payload.granules[0].cmrLink;

      expect(postToCmrOutput.payload).toEqual(updatedExpectedpayload);
    });

    it('publishes the granule metadata to CMR', async () => {
      const result = await conceptExists(granule.cmrLink);

      expect(granule.published).toEqual(true);
      expect(result).not.toEqual(false);
    });

    it('updates the CMR metadata online resources with the final metadata location', () => {
      const distEndpoint = config.DISTRIBUTION_ENDPOINT;
      const extension1 = urljoin(files[0].bucket, files[0].filepath);
      const filename = `https://${files[2].bucket}.s3.amazonaws.com/${files[2].filepath}`;

      expect(resourceHrefs.includes(urljoin(distEndpoint, extension1))).toBe(true);
      expect(resourceHrefs.includes(filename)).toBe(true);
      expect(response.statusCode).toEqual(200);
    });

    it('does not overwrite the original related url', () => {
      expect(resourceHrefs.includes(cumulusDocUrl)).toBe(true);
    });
  });


  describe('When moving a granule via the Cumulus API', () => {
    let file;
    let destinationKey;
    let destinations;
    let originalUmm;
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

      originalUmm = await getUmmObject(newS3UMMJsonFileLocation);
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

      const relatedUrlDifferences = differenceWith(updatedUmm.RelatedUrls, originalUmm.RelatedUrls, isEqual);

      // Only the file that was moved was updated
      expect(relatedUrlDifferences.length).toEqual(1);

      expect(relatedUrlDifferences[0].URL).toContain(destinationKey);
    });
  });
});
