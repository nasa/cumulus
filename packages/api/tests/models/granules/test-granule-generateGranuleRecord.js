const test = require('ava');
const sinon = require('sinon');

const s3Utils = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { removeNilProperties } = require('@cumulus/common/util');

const { filterDatabaseProperties } = require('../../../lib/FileUtils');
const Granule = require('../../../models/granules');

const granuleSuccess = require('../../data/granule_success.json');
const granuleFailure = require('../../data/granule_failed.json');

let sandbox;

const mockedFileSize = 12345;

const granuleFileToRecord = (granuleFile, provider) => {
  const granuleRecord = {
    size: mockedFileSize,
    ...granuleFile,
    key: s3Utils.parseS3Uri(granuleFile.filename).Key,
    fileName: granuleFile.name,
    checksum: granuleFile.checksum,
  };

  if (granuleFile.path) {
    granuleRecord.source = `${provider.protocol}://${provider.host}/granules/${granuleFile.name}`;
  }

  return removeNilProperties(filterDatabaseProperties(granuleRecord));
};

test.before(async (t) => {
  process.env.GranulesTable = randomString();
  await new Granule().createTable();

  sandbox = sinon.createSandbox();

  t.context.fakeCmrMetadata = {
    beginningDateTime: '2017-10-24T00:00:00.000Z',
    endingDateTime: '2018-10-24T00:00:00.000Z',
    lastUpdateDateTime: '2018-04-20T21:45:45.524Z',
    productionDateTime: '2018-04-25T21:45:45.524Z',
  };
  const fakeCmrUtils = {
    getGranuleTemporalInfo: () => Promise.resolve(t.context.fakeCmrMetadata),
  };
  t.context.granuleModel = new Granule({
    cmrUtils: fakeCmrUtils,
  });

  t.context.fakeS3 = {
    headObject: () => ({
      promise: async () => ({
        ContentLength: mockedFileSize,
      }),
    }),
  };
});

test.beforeEach((t) => {
  t.context.provider = {
    name: randomString(),
    protocol: 's3',
    host: randomString(),
  };
  t.context.collectionId = randomString();
  t.context.pdrName = randomString();
  t.context.workflowStartTime = Date.now();
  t.context.workflowStatus = 'completed';
});

test.after.always(() => {
  sandbox.restore();
});

test('generateGranuleRecord() builds successful granule record', async (t) => {
  const {
    collectionId,
    provider,
    granuleModel,
    workflowStartTime,
    pdrName,
    workflowStatus,
  } = t.context;
  const granule = granuleSuccess.payload.granules[0];
  const executionUrl = randomString();

  const processingStartDateTime = new Date(Date.UTC(2019, 6, 28)).toISOString();
  const processingEndDateTime = new Date(Date.UTC(2019, 6, 28, 1)).toISOString();
  const record = await granuleModel.generateGranuleRecord({
    s3: t.context.fakeS3,
    granule,
    executionUrl,
    processingTimeInfo: {
      processingStartDateTime,
      processingEndDateTime,
    },
    collectionId,
    provider,
    workflowStartTime,
    pdrName,
    workflowStatus,
  });

  t.deepEqual(
    record.files,
    granule.files.map((file) => granuleFileToRecord(file, provider))
  );
  t.is(record.createdAt, workflowStartTime);
  t.is(typeof record.duration, 'number');
  t.is(record.status, workflowStatus);
  t.is(record.pdrName, pdrName);
  t.is(record.collectionId, collectionId);
  t.is(record.execution, executionUrl);
  t.is(record.granuleId, granule.granuleId);
  t.is(record.cmrLink, granule.cmrLink);
  t.is(record.published, granule.published);
  t.is(record.productVolume, 17934423);
  t.is(record.beginningDateTime, t.context.fakeCmrMetadata.beginningDateTime);
  t.is(record.endingDateTime, t.context.fakeCmrMetadata.endingDateTime);
  t.is(record.productionDateTime, t.context.fakeCmrMetadata.productionDateTime);
  t.is(record.lastUpdateDateTime, t.context.fakeCmrMetadata.lastUpdateDateTime);
  t.is(record.timeToArchive, 100 / 1000);
  t.is(record.timeToPreprocess, 120 / 1000);
  t.is(record.processingStartDateTime, processingStartDateTime);
  t.is(record.processingEndDateTime, processingEndDateTime);
});

test('generateGranuleRecord() builds a failed granule record', async (t) => {
  const {
    collectionId,
    provider,
    granuleModel,
    workflowStartTime,
  } = t.context;
  const granule = granuleFailure.payload.granules[0];
  const executionUrl = randomString();
  const error = {
    Error: 'error',
    Cause: new Error('error'),
  };
  const record = await granuleModel.generateGranuleRecord({
    s3: t.context.fakeS3,
    granule,
    message: granuleFailure,
    executionUrl,
    provider,
    collectionId,
    workflowStartTime,
    workflowStatus: 'failed',
    error,
  });

  t.deepEqual(
    record.files,
    granule.files.map((file) => granuleFileToRecord(file, provider))
  );
  t.is(record.status, 'failed');
  t.is(record.execution, executionUrl);
  t.is(record.granuleId, granule.granuleId);
  t.is(record.published, false);
  t.is(record.error.Error, error.Error);
  t.is(record.error.Cause, error.Cause);
});
