const fs = require('fs-extra');
const moment = require('moment');
const AWS = require('aws-sdk');
const path = require('path');
const os = require('os');

const {
  aws: {
    fileExists,
    getS3Object,
    parseS3Uri,
    lambda
  },
  constructCollectionId,
  http: {
    download
  }
} = require('@cumulus/common');
const { sleep } = require('@cumulus/common/util');
const { Granule, AccessToken } = require('@cumulus/api/models');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupProviders,
  distributionApi: {
    getDistributionApiRedirect
  },
  EarthdataLogin: { getEarthdataAccessToken },
  emsApi,
  getOnlineResources,
  granulesApi: granulesApiTestUtils
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../../helpers/testUtils');
const {
  setDistributionApiEnvVars,
  waitForModelStatus
} = require('../../helpers/apiUtils');

const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD14A1_006';
const inputPayloadFilename = './spec/parallel/emsReport/IngestGranule.MOD14A1_006.input.payload.json';
const collection = { name: 'MOD14A1', version: '006' };
const collectionId = constructCollectionId(collection.name, collection.version);
const granuleRegex = '^MOD14A1\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

// add MOD14A1___006 collection
async function setupCollectionAndTestData(config, testSuffix, testDataFolder) {
  const s3data = [
    '@cumulus/test-data/granules/MOD14A1.A2000049.h00v10.006.2015041132152.hdf.met',
    '@cumulus/test-data/granules/MOD14A1.A2000049.h00v10.006.2015041132152.hdf',
    '@cumulus/test-data/granules/BROWSE.MOD14A1.A2000049.h00v10.006.2015041132152.1.jpg'
  ];

  // populate collections, providers and test data
  await Promise.all([
    uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
    addCollections(config.stackName, config.bucket, collectionsDir),
    addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
  ]);
}

// ingest a granule and publish if requested
async function ingestAndPublishGranule(config, testSuffix, testDataFolder, publish = true) {
  const workflowName = publish ? 'IngestAndPublishGranule' : 'IngestGranule';
  const provider = { id: `s3_provider${testSuffix}` };

  const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
  // update test data filepaths
  const inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, '', testDataFolder);

  await buildAndExecuteWorkflow(
    config.stackName, config.bucket, workflowName, collection, provider, inputPayload
  );

  await waitForModelStatus(
    new Granule(),
    { granuleId: inputPayload.granules[0].granuleId },
    'completed'
  );

  return inputPayload.granules[0].granuleId;
}

/**
 * delete old granules
 *
 * @param {string} stackName - the name of the stack
 * @param {number} retentionInDays - granules are deleted if older than specified days
 * @param {Array<string>} additionalGranuleIds - additional granules to delete
 */
async function deleteOldGranules(stackName, retentionInDays, additionalGranuleIds) {
  const dbGranulesIterator = (new Granule()).getGranulesForCollection(collectionId, 'completed');
  let nextDbItem = await dbGranulesIterator.peek();
  while (nextDbItem) {
    const nextDbGranuleId = nextDbItem.granuleId;
    const offset = Date.now() - retentionInDays * 24 * 3600 * 1000;
    if (nextDbItem.createdAt <= offset || additionalGranuleIds.includes(nextDbGranuleId)) {
      if (nextDbItem.published) {
        // eslint-disable-next-line no-await-in-loop
        await granulesApiTestUtils.removePublishedGranule({ prefix: stackName, granuleId: nextDbGranuleId });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await granulesApiTestUtils.deleteGranule({ prefix: stackName, granuleId: nextDbGranuleId });
      }
    }

    await dbGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
    nextDbItem = await dbGranulesIterator.peek(); // eslint-disable-line no-await-in-loop
  }
}

// return granule files which can be downloaded
async function getGranuleFilesForDownload(stackName, granuleId) {
  const granuleResponse = await granulesApiTestUtils.getGranule({ prefix: stackName, granuleId });
  const granule = JSON.parse(granuleResponse.body);
  const cmrResource = await getOnlineResources({ cmrMetadataFormat: 'echo10', ...granule });
  return granule.files
    .filter((file) => (cmrResource.filter((resource) => resource.href.endsWith(file.fileName)).length > 0));
}

describe('The EMS report', () => {
  let bucket;
  let config;
  let dataSource;
  let deletedGranuleId;
  let emsDistributionReportLambda;
  let emsIngestReportLambda;
  let emsProvider;
  let ingestedGranuleIds;
  let submitReport;
  let testDataFolder;
  let testSuffix;

  beforeAll(async () => {
    config = await loadConfig();

    process.env.stackName = config.stackName;

    emsIngestReportLambda = `${config.stackName}-EmsIngestReport`;
    emsDistributionReportLambda = `${config.stackName}-EmsDistributionReport`;
    bucket = config.bucket;
    const emsTestConfig = await emsApi.getLambdaEmsSettings(emsDistributionReportLambda);
    emsProvider = emsTestConfig.provider;
    submitReport = emsTestConfig.submitReport === 'true' || false;
    dataSource = emsTestConfig.dataSource || config.stackName;

    process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
    process.env.GranulesTable = `${config.stackName}-GranulesTable`;
    process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;

    // in order to generate the ingest reports here and by daily cron, we need to ingest granules
    // as well as delete granules

    const testId = createTimestampedTestId(config.stackName, 'emsIngestReport');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    await setupCollectionAndTestData(config, testSuffix, testDataFolder);
    // ingest one granule, this will be deleted later
    deletedGranuleId = await ingestAndPublishGranule(config, testSuffix, testDataFolder);

    // delete granules ingested for this collection, so that ArchDel report can be generated.
    // leave some granules for distribution report since the granule and collection information
    // is needed for distributed files.
    await deleteOldGranules(config.stackName, 2, [deletedGranuleId]);

    // ingest two new granules, so that Archive and Ingest reports can be generated
    ingestedGranuleIds = await Promise.all([
      // ingest a granule and publish it to CMR
      ingestAndPublishGranule(config, testSuffix, testDataFolder),

      // ingest a granule but not publish it to CMR
      ingestAndPublishGranule(config, testSuffix, testDataFolder, false)
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      // leave collection in the table for daily reports
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix)
    ]);
  });

  describe('When run automatically', () => {
    let expectReports = false;
    beforeAll(async () => {
      const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
      AWS.config.update({ region: region });

      const lambdaConfig = await lambda().getFunctionConfiguration({ FunctionName: emsIngestReportLambda })
        .promise();
      const lastUpdate = lambdaConfig.LastModified;

      // Compare lambda function's lastUpdate with the time 24 hours before now.
      // If the lambda is created/modified more than 24 hours ago, it must have been invoked
      // and generated EMS reports for the previous day.
      if (new Date(lastUpdate).getTime() < moment.utc().subtract(24, 'hours').toDate().getTime()) {
        expectReports = true;
      }
    });

    it('generates EMS reports every 24 hours', async () => {
      if (expectReports) {
        const datestring = moment.utc().format('YYYYMMDD');
        const types = ['Ing', 'Arch', 'ArchDel', 'DistCustom'];
        const jobs = types.map((type) => {
          const filename = `${datestring}_${emsProvider}_${type}_${dataSource}.flt`;
          const reportFolder = (type === 'DistCustom') ? 'ems-distribution/reports' : 'ems';
          const key = `${config.stackName}/${reportFolder}/${filename}`;
          const sentKey = `${config.stackName}/${reportFolder}/sent/${filename}`;
          return fileExists(bucket, key) || fileExists(bucket, sentKey);
        });
        const results = await Promise.all(jobs);
        results.forEach((result) => expect(result).not.toBe('false'));
      }
    });
  });

  describe('After execution of EmsIngestReport lambda', () => {
    let lambdaOutput;
    beforeAll(async () => {
      const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
      AWS.config.update({ region: region });

      // add a few seconds to allow records searchable in elasticsearch
      await sleep(5 * 1000);
      const endTime = moment.utc().add(1, 'days').startOf('day').format();
      const startTime = moment.utc().startOf('day').format();

      const response = await lambda().invoke({
        FunctionName: emsIngestReportLambda,
        Payload: JSON.stringify({
          startTime,
          endTime
        })
      }).promise()
        .catch((err) => console.log('invoke err', err));

      lambdaOutput = JSON.parse(response.Payload);
    });

    it('generates EMS ingest reports', async () => {
      // generated reports should have the records just ingested or deleted
      expect(lambdaOutput.length).toEqual(3);
      const jobs = lambdaOutput.map(async (report) => {
        const parsed = parseS3Uri(report.file);
        const obj = await getS3Object(parsed.Bucket, parsed.Key);
        const reportRecords = obj.Body.toString().split('\n');
        if (['ingest', 'archive'].includes(report.reportType)) {
          const records = reportRecords.filter((record) =>
            record.startsWith(ingestedGranuleIds[0]) || record.startsWith(ingestedGranuleIds[1]));
          expect(records.length).toEqual(2);
          records.forEach((record) =>
            expect(record.split('|&|').find((field) => field.length === 0)).toBeFalsy());
        }
        if (report.reportType === 'delete') {
          const records = reportRecords.filter((record) =>
            record.startsWith(deletedGranuleId));
          expect(records.length).toEqual(1);
        }

        if (submitReport) {
          expect(parsed.Key.includes('/sent/')).toBe(true);
        }

        return true;
      });
      const results = await Promise.all(jobs);
      results.forEach((result) => expect(result).not.toBe(false));
    });

    it('generates EMS ingest reports through the Cumulus API', async () => {
      const inputPayload = {
        reportType: 'ingest',
        startTime: moment.utc().subtract(1, 'days').startOf('day').format(),
        endTime: moment.utc().add(1, 'days').startOf('day').format(),
        collectionId,
        invocationType: 'RequestResponse'
      };

      const response = await emsApi.createEmsReports({
        prefix: config.stackName,
        request: inputPayload
      });

      const reports = JSON.parse(response.body).reports;
      expect(reports.length).toEqual(6);

      const jobs = reports.slice(3).map(async (report) => {
        const parsed = parseS3Uri(report.file);
        const obj = await getS3Object(parsed.Bucket, parsed.Key);
        const reportRecords = obj.Body.toString().split('\n');
        if (['ingest', 'archive'].includes(report.reportType)) {
          const records = reportRecords.filter((record) =>
            record.startsWith(ingestedGranuleIds[0]) || record.startsWith(ingestedGranuleIds[1]));
          expect(records.length).toEqual(2);
        }
        if (report.reportType === 'delete') {
          const records = reportRecords.filter((record) =>
            record.startsWith(deletedGranuleId));
          expect(records.length).toEqual(1);
        }

        return true;
      });
      const results = await Promise.all(jobs);
      results.forEach((result) => expect(result).not.toBe(false));
    });
  });

  describe('When there are distribution requests', () => {
    let accessToken;

    beforeAll(async () => {
      setDistributionApiEnvVars();
      const accessTokenResponse = await getEarthdataAccessToken({
        redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
        requestOrigin: process.env.DISTRIBUTION_ENDPOINT
      });
      accessToken = accessTokenResponse.accessToken;
    });

    afterAll(() => (new AccessToken()).delete({ accessToken }));

    // the s3 server access log records are delivered within a few hours of the time that they are recorded,
    // so we are not able to generate the distribution report immediately after submitting distribution requests,
    // the distribution requests submitted here are for nightly distribution report.
    // TODO Update this to work with the Thin Egress App
    xit('downloads the files of the published granule for generating nightly distribution report', async () => {
      const files = await getGranuleFilesForDownload(config.stackName, ingestedGranuleIds[0]);
      for (let i = 0; i < files.length; i += 1) {
        const filePath = `/${files[i].bucket}/${files[i].key}`;
        const downloadedFile = path.join(os.tmpdir(), files[i].fileName);
        // eslint-disable-next-line no-await-in-loop
        const s3SignedUrl = await getDistributionApiRedirect(filePath, accessToken);
        // eslint-disable-next-line no-await-in-loop
        await download(s3SignedUrl, downloadedFile);
        fs.unlinkSync(downloadedFile);
      }
    });

    describe('After execution of EmsDistributionReport lambda', () => {
      let lambdaOutput;
      beforeAll(async () => {
        const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
        AWS.config.update({ region: region });

        const endTime = moment.utc().add(1, 'days').startOf('day').format();
        const startTime = moment.utc().startOf('day').format();

        const response = await lambda().invoke({
          FunctionName: emsDistributionReportLambda,
          Payload: JSON.stringify({
            startTime,
            endTime
          })
        }).promise()
          .catch((err) => console.log('invoke err', err));

        lambdaOutput = JSON.parse(response.Payload);
      });

      it('generates an EMS distribution report', async () => {
        // verify report is generated, but can't verify the content since the s3 server access log
        // won't have recent access records until hours or minutes later
        expect(lambdaOutput.length).toEqual(1);
        const jobs = lambdaOutput.map(async (report) => {
          const parsed = parseS3Uri(report.file);
          expect(await fileExists(parsed.Bucket, parsed.Key)).not.toBe(false);

          if (submitReport) {
            expect(parsed.Key.includes('/sent/')).toBe(true);
          }

          return true;
        });
        const results = await Promise.all(jobs);
        results.forEach((result) => expect(result).not.toBe(false));
      });

      it('generates EMS distribution reports through the Cumulus API', async () => {
        // it could take long to generate distribution reports (greater than ApiEndpoints timeout),
        // so use async call
        const inputPayload = {
          reportType: 'distribution',
          startTime: moment.utc().subtract(1, 'days').startOf('day').format(),
          endTime: moment.utc().add(1, 'days').startOf('day').format(),
          collectionId
        };

        const response = await emsApi.createEmsReports({
          prefix: config.stackName,
          request: inputPayload
        });

        const message = JSON.parse(response.body).message;
        expect(message === 'Reports are being generated').toBe(true);
      });
    });
  });
});
