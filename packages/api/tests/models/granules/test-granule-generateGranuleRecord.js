const cloneDeep = require('lodash/cloneDeep');
const test = require('ava');
const sinon = require('sinon');

const s3Utils = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { filterDatabaseProperties } = require('../../../lib/FileUtils');
const { deconstructCollectionId } = require('../../../lib/utils');
const Granule = require('../../../models/granules');

const granuleSuccess = require('../../data/granule_success.json');
const granuleFailure = require('../../data/granule_failed.json');

let fakeExecution;
let sandbox;
let testCumulusMessage;

const mockedFileSize = 12345;

const granuleFileToRecord = (granuleFile) => {
  const granuleRecord = {
    size: mockedFileSize,
    ...granuleFile,
    key: s3Utils.parseS3Uri(granuleFile.filename).Key,
    fileName: granuleFile.name,
    checksum: granuleFile.checksum,
  };

  if (granuleFile.path) {
    // This hard-coded URL comes from the provider configure in the
    // test fixtures (e.g. data/granule_success.json)
    granuleRecord.source = `https://07f1bfba.ngrok.io/granules/${granuleFile.name}`;
  }

  return removeNilProperties(filterDatabaseProperties(granuleRecord));
};

test.before(async (t) => {
  process.env.GranulesTable = randomString();
  await new Granule().createTable();

  testCumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
      state_machine: 'arn:aws:states:us-east-1:123456789012:stateMachine:HelloStateMachine',
      workflow_start_time: Date.now(),
    },
    meta: {
      collection: {
        name: randomString(),
        version: randomString(),
      },
      provider: {
        host: randomString(),
        protocol: 's3',
      },
      status: 'completed',
    },
    payload: {
      granules: [
        {
          granuleId: randomString(),
          sync_granule_duration: 123,
          post_to_cmr_duration: 456,
          files: [],
        },
      ],
    },
  };

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

  fakeExecution = {
    input: JSON.stringify(testCumulusMessage),
    startDate: new Date(Date.UTC(2019, 6, 28)),
    stopDate: new Date(Date.UTC(2019, 6, 28, 1)),
  };

  t.context.fakeS3 = {
    headObject: () => ({
      promise: async () => ({
        ContentLength: mockedFileSize,
      }),
    }),
  };
});

test.beforeEach((t) => {
  t.context.cumulusMessage = testCumulusMessage;
});

test.after.always(() => {
  sandbox.restore();
});

test(
  'generateGranuleRecord() properly sets timeToPreprocess when sync_granule_duration is present for a granule',
  async (t) => {
    const { granuleModel } = t.context;
    const cumulusMessage = cloneDeep(t.context.cumulusMessage);
    const [granule] = cumulusMessage.payload.granules;
    cumulusMessage.payload.granules[0].sync_granule_duration = 123;

    const record = await granuleModel.generateGranuleRecord({
      s3: t.context.fakeS3,
      granule,
      message: cumulusMessage,
      executionUrl: randomString(),
    });

    t.is(record.timeToPreprocess, 0.123);
  }
);

test(
  'generateGranuleRecord() properly sets timeToPreprocess when sync_granule_duration is not present for a granule',
  async (t) => {
    const { granuleModel } = t.context;
    const cumulusMessage = cloneDeep(t.context.cumulusMessage);
    const [granule] = cumulusMessage.payload.granules;
    cumulusMessage.payload.granules[0].sync_granule_duration = 0;

    const record = await granuleModel.generateGranuleRecord({
      s3: t.context.fakeS3,
      granule,
      message: cumulusMessage,
      executionUrl: randomString(),
    });

    t.is(record.timeToPreprocess, 0);
  }
);

test(
  'generateGranuleRecord() properly sets timeToArchive when post_to_cmr_duration is present for a granule',
  async (t) => {
    const { granuleModel } = t.context;
    const cumulusMessage = cloneDeep(t.context.cumulusMessage);
    const [granule] = cumulusMessage.payload.granules;
    cumulusMessage.payload.granules[0].post_to_cmr_duration = 123;

    const record = await granuleModel.generateGranuleRecord({
      s3: t.context.fakeS3,
      granule,
      message: cumulusMessage,
      executionUrl: randomString(),
    });

    t.is(record.timeToArchive, 0.123);
  }
);

test(
  'generateGranuleRecord() properly sets timeToArchive when post_to_cmr_duration is not present for a granule',
  async (t) => {
    const { granuleModel } = t.context;
    const cumulusMessage = cloneDeep(t.context.cumulusMessage);
    const [granule] = cumulusMessage.payload.granules;
    cumulusMessage.payload.granules[0].post_to_cmr_duration = 0;

    const record = await granuleModel.generateGranuleRecord({
      s3: t.context.fakeS3,
      granule,
      message: cumulusMessage,
      executionUrl: randomString(),
    });

    t.is(record.timeToArchive, 0);
  }
);

test('generateGranuleRecord() builds successful granule record', async (t) => {
  const { granuleModel } = t.context;
  const granule = granuleSuccess.payload.granules[0];
  const collection = granuleSuccess.meta.collection;
  const collectionId = constructCollectionId(collection.name, collection.version);
  const executionUrl = randomString();

  const record = await granuleModel.generateGranuleRecord({
    s3: t.context.fakeS3,
    granule,
    message: granuleSuccess,
    executionUrl,
    executionDescription: fakeExecution,
  });

  t.deepEqual(
    record.files,
    granule.files.map(granuleFileToRecord)
  );
  t.is(record.createdAt, 1519167138335);
  t.is(typeof record.duration, 'number');
  t.is(record.status, 'completed');
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
  t.is(record.processingStartDateTime, '2019-07-28T00:00:00.000Z');
  t.is(record.processingEndDateTime, '2019-07-28T01:00:00.000Z');

  const { name: deconstructed } = deconstructCollectionId(record.collectionId);
  t.is(deconstructed, collection.name);
});

test('generateGranuleRecord() builds a failed granule record', async (t) => {
  const { granuleModel } = t.context;
  const granule = granuleFailure.payload.granules[0];
  const executionUrl = randomString();
  const record = await granuleModel.generateGranuleRecord({
    s3: t.context.fakeS3,
    granule,
    message: granuleFailure,
    executionUrl,
    executionDescription: fakeExecution,
  });

  t.deepEqual(
    record.files,
    granule.files.map(granuleFileToRecord)
  );
  t.is(record.status, 'failed');
  t.is(record.execution, executionUrl);
  t.is(record.granuleId, granule.granuleId);
  t.is(record.published, false);
  t.is(record.error.Error, granuleFailure.exception.Error);
  t.is(record.error.Cause, granuleFailure.exception.Cause);
});
