'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const cloneDeep = require('lodash/cloneDeep');
const mapValues = require('lodash/mapValues');

const {
  getGranuleQueryFields,
  getGranuleStatus,
  getMessageGranules,
  messageHasGranules,
  getGranuleProductVolume,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  generateGranuleApiRecord,
  getGranuleCmrTemporalInfo,
  getGranuleProcessingTimeInfo,
} = require('../Granules');
const {
  getWorkflowDuration,
} = require('../workflows');

const granuleSuccess = require('./fixtures/data/granule_success.json');
const granuleFailure = require('./fixtures/data/granule_failed.json');

const randomId = (prefix) => `${prefix}${cryptoRandomString({ length: 10 })}`;

test.before((t) => {
  t.context.fakeCmrMetadata = {
    beginningDateTime: '2017-10-24T00:00:00.000Z',
    endingDateTime: '2018-10-24T00:00:00.000Z',
    lastUpdateDateTime: '2018-04-20T21:45:45.524Z',
    productionDateTime: '2018-04-25T21:45:45.524Z',
  };
  t.context.fakeCmrUtils = {
    getGranuleTemporalInfo: () => Promise.resolve(t.context.fakeCmrMetadata),
  };
});

test.beforeEach((t) => {
  t.context.granuleSuccess = cloneDeep(granuleSuccess);
  t.context.granuleFailure = cloneDeep(granuleFailure);
  t.context.provider = {
    name: cryptoRandomString({ length: 10 }),
    protocol: 's3',
    host: cryptoRandomString({ length: 10 }),
  };
  t.context.collectionId = cryptoRandomString({ length: 10 });
  t.context.pdrName = cryptoRandomString({ length: 10 });
  t.context.workflowStartTime = Date.now();
  t.context.workflowStatus = 'completed';

  t.context.timestampExtraPrecision = '2018-04-25T21:45:45.524053';
});

test('getMessageGranules returns granules from payload.granules', (t) => {
  const granules = [{
    granuleId: randomId('granule'),
  }];
  const testMessage = {
    payload: {
      granules,
    },
  };
  const result = getMessageGranules(testMessage);
  t.deepEqual(result, granules);
});

test('getMessageGranules returns an empty array when granules are absent from message', (t) => {
  const testMessage = {};
  const result = getMessageGranules(testMessage);
  t.deepEqual(result, []);
});

test('getGranuleStatus returns workflow status', (t) => {
  t.is(
    getGranuleStatus(
      'completed',
      { status: 'foo' }
    ),
    'completed'
  );
});

test('getGranuleStatus returns status from granule', (t) => {
  t.is(
    getGranuleStatus(
      undefined,
      { status: 'failed' }
    ),
    'failed'
  );
});

test('getGranuleQueryFields returns query fields, if any', (t) => {
  const queryFields = { foo: 'bar' };
  t.deepEqual(
    getGranuleQueryFields(
      {
        meta: {
          granule: {
            queryFields,
          },
        },
      }
    ),
    queryFields
  );
});

test('getGranuleQueryFields returns undefined', (t) => {
  t.is(
    getGranuleQueryFields({}),
    undefined
  );
});

test('messageHasGranules returns undefined if message does not have granules', (t) => {
  t.is(
    messageHasGranules({}),
    false
  );
});

test('messageHasGranules returns granules object if message has granules', (t) => {
  const payloadObject = { payload: { granules: ['someGranuleObject'] } };
  t.is(
    messageHasGranules(payloadObject),
    true
  );
});

test('getGranuleTimeToArchive() returns 0 if post_to_cmr_duration is missing from granule', (t) => {
  t.is(getGranuleTimeToArchive(), 0);
});

test('getGranuleTimeToArchive() returns correct duration', (t) => {
  const postToCmrDuration = 5000;
  t.is(
    getGranuleTimeToArchive({
      post_to_cmr_duration: postToCmrDuration,
    }),
    5
  );
});

test('getGranuleTimeToPreprocess() returns 0 if sync_granule_duration is missing from granule', (t) => {
  t.is(getGranuleTimeToPreprocess(), 0);
});

test('getGranuleTimeToPreprocess() returns correct duration', (t) => {
  const syncGranuleDuration = 3000;
  t.is(
    getGranuleTimeToPreprocess({
      sync_granule_duration: syncGranuleDuration,
    }),
    3
  );
});

test('getGranuleProductVolume() returns correct product volume', (t) => {
  t.is(
    getGranuleProductVolume([{
      size: 1,
    }, {
      size: 2,
    }]),
    '3'
  );

  t.is(
    getGranuleProductVolume([{
      foo: '1',
    }, {
      size: 'not-a-number',
    }]),
    '0'
  );
});

test('getGranuleProductVolume() returns correct product volume for large file sizes', (t) => {
  t.is(
    getGranuleProductVolume([{
      size: Number.MAX_SAFE_INTEGER,
    }, {
      size: Number.MAX_SAFE_INTEGER,
    }]),
    String(BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2))
  );
});

test('generateGranuleApiRecord() builds successful granule record', async (t) => {
  const {
    collectionId,
    provider,
    pdrName,
    workflowStatus,
  } = t.context;
  const granule = t.context.granuleSuccess.payload.granules[0];
  granule.createdAt = Date.now();

  const executionUrl = cryptoRandomString({ length: 10 });

  const processingStartDateTime = new Date(Date.UTC(2019, 6, 28)).toISOString();
  const processingEndDateTime = new Date(Date.UTC(2019, 6, 28, 1)).toISOString();
  const timeToArchive = getGranuleTimeToArchive(granule);
  const timeToPreprocess = getGranuleTimeToPreprocess(granule);
  const productVolume = getGranuleProductVolume(granule.files);
  const status = getGranuleStatus(workflowStatus, granule);
  const duration = getWorkflowDuration(granule.createdAt, Date.now());

  const record = await generateGranuleApiRecord({
    granule: { ...granule },
    executionUrl,
    processingTimeInfo: {
      processingStartDateTime,
      processingEndDateTime,
    },
    collectionId,
    provider,
    pdrName,
    status,
    duration,
    cmrUtils: t.context.fakeCmrUtils,
    // in reality files comes from FileUtils.buildDatabaseFiles
    // and not the raw granule.files, but that functionality is tested
    // elsewhere and doesn't need to be re-verified here
    files: granule.files,
    timeToArchive,
    timeToPreprocess,
    productVolume,
  });

  t.deepEqual(
    record.files,
    granule.files
  );

  t.is(record.createdAt, granule.createdAt);
  t.is(typeof record.duration, 'number');
  t.is(record.status, workflowStatus);
  t.is(record.pdrName, pdrName);
  t.is(record.collectionId, collectionId);
  t.is(record.execution, executionUrl);
  t.is(record.granuleId, granule.granuleId);
  t.is(record.cmrLink, granule.cmrLink);
  t.is(record.published, granule.published);
  t.is(record.productVolume, '17934423');
  t.is(record.beginningDateTime, t.context.fakeCmrMetadata.beginningDateTime);
  t.is(record.endingDateTime, t.context.fakeCmrMetadata.endingDateTime);
  t.is(record.productionDateTime, t.context.fakeCmrMetadata.productionDateTime);
  t.is(record.lastUpdateDateTime, t.context.fakeCmrMetadata.lastUpdateDateTime);
  t.is(record.timeToArchive, 100 / 1000);
  t.is(record.timeToPreprocess, 120 / 1000);
  t.is(record.processingStartDateTime, processingStartDateTime);
  t.is(record.processingEndDateTime, processingEndDateTime);
});

test('getGranuleCmrTemporalInfo() converts input CMR timestamps to standardized format', async (t) => {
  const { timestampExtraPrecision } = t.context;

  const cmrTemporalInfo = {
    beginningDateTime: timestampExtraPrecision,
    endingDateTime: timestampExtraPrecision,
    productionDateTime: timestampExtraPrecision,
    lastUpdateDateTime: timestampExtraPrecision,
  };

  const updatedCmrTemporalInfo = await getGranuleCmrTemporalInfo({
    granule: {},
    cmrTemporalInfo,
    cmrUtils: {},
  });

  t.deepEqual(updatedCmrTemporalInfo, {
    beginningDateTime: new Date(timestampExtraPrecision).toISOString(),
    endingDateTime: new Date(timestampExtraPrecision).toISOString(),
    productionDateTime: new Date(timestampExtraPrecision).toISOString(),
    lastUpdateDateTime: new Date(timestampExtraPrecision).toISOString(),
  });
});

test('getGranuleCmrTemporalInfo() converts timestamps fetched from CMR to standardized format', async (t) => {
  const { timestampExtraPrecision } = t.context;

  const cmrTemporalInfo = {
    beginningDateTime: timestampExtraPrecision,
    endingDateTime: timestampExtraPrecision,
    productionDateTime: timestampExtraPrecision,
    lastUpdateDateTime: timestampExtraPrecision,
  };
  const granule = {
    granuleId: cryptoRandomString({ length: 10 }),
  };

  const updatedCmrTemporalInfo = await getGranuleCmrTemporalInfo({
    granule,
    cmrUtils: {
      getGranuleTemporalInfo: (granuleArg) => {
        if (granule.granuleId === granuleArg.granuleId) {
          return Promise.resolve(cmrTemporalInfo);
        }
        throw new Error('should not be reached');
      },
    },
  });

  t.deepEqual(updatedCmrTemporalInfo, {
    beginningDateTime: new Date(timestampExtraPrecision).toISOString(),
    endingDateTime: new Date(timestampExtraPrecision).toISOString(),
    productionDateTime: new Date(timestampExtraPrecision).toISOString(),
    lastUpdateDateTime: new Date(timestampExtraPrecision).toISOString(),
  });
});

test('getGranuleCmrTemporalInfo() handles empty return from CMR', async (t) => {
  const updatedCmrTemporalInfo = await getGranuleCmrTemporalInfo({
    granule: {},
    cmrUtils: {
      getGranuleTemporalInfo: () => Promise.resolve({}),
    },
  });

  t.deepEqual(updatedCmrTemporalInfo, {});
});

test('getGranuleCmrTemporalInfo() handles empty return from CMR and gets temporal info from granule object', async (t) => {
  const updatedCmrTemporalInfo = await getGranuleCmrTemporalInfo({
    granule: t.context.fakeCmrMetadata,
    cmrUtils: {
      getGranuleTemporalInfo: () => Promise.resolve({}),
    },
  });

  t.deepEqual(updatedCmrTemporalInfo, t.context.fakeCmrMetadata);
});

test('getGranuleCmrTemporalInfo() returns null for null values', async (t) => {
  const granule = {
    beginningDateTime: null,
    endingDateTime: null,
    productionDateTime: null,
    lastUpdateDateTime: null,
  };
  const cmrUtils = {
    getGranuleTemporalInfo: () => Promise.resolve(granule),
  };

  const result = await getGranuleCmrTemporalInfo({ cmrTemporalInfo: {}, granule, cmrUtils });
  t.deepEqual(result, granule);
});

test('getGranuleCmrTemporalInfo() returns null for empty string', async (t) => {
  const granule = {
    beginningDateTime: '',
    endingDateTime: '',
    productionDateTime: '',
    lastUpdateDateTime: '',
  };
  const cmrUtils = {
    getGranuleTemporalInfo: () => Promise.resolve(granule),
  };

  const expected = mapValues(granule, () => null);

  const result = await getGranuleCmrTemporalInfo({ cmrTemporalInfo: {}, granule, cmrUtils });
  t.deepEqual(result, expected);
});

test('getGranuleCmrTemporalInfo() returns undefined for explicitly defined undefined keys', async (t) => {
  const granule = {
    beginningDateTime: undefined,
    endingDateTime: undefined,
    productionDateTime: undefined,
    lastUpdateDateTime: undefined,
  };
  const cmrUtils = {
    getGranuleTemporalInfo: () => Promise.resolve(granule),
  };

  const expected = mapValues(granule, () => undefined);

  const result = await getGranuleCmrTemporalInfo({ cmrTemporalInfo: {}, granule, cmrUtils });
  t.deepEqual(result, expected);
});

test('getGranuleProcessingTimeInfo() converts input timestamps to standardized format', (t) => {
  const { timestampExtraPrecision } = t.context;

  const processingTimeInfo = {
    processingStartDateTime: timestampExtraPrecision,
    processingEndDateTime: timestampExtraPrecision,
  };

  const updatedProcessingTimeInfo = getGranuleProcessingTimeInfo(processingTimeInfo);

  t.deepEqual(updatedProcessingTimeInfo, {
    processingStartDateTime: new Date(timestampExtraPrecision).toISOString(),
    processingEndDateTime: new Date(timestampExtraPrecision).toISOString(),
  });
});

test('(getGranuleProcessingTimeInfo() returns null for missing beginningDateTime', (t) => {
  const granule = {
    processingEndDateTime: '2023-01-01T01:00:00.000Z',
    processingStartDateTime: null,
  };
  const result = getGranuleProcessingTimeInfo(granule);
  t.deepEqual(result, granule);
});

test('getGranuleProcessingTimeInfo() returns null for missing endingDateTime', (t) => {
  const granule = {
    processingEndDateTime: null,
    processingStartDateTime: '2023-01-01T01:00:00.000Z',
  };
  const result = getGranuleProcessingTimeInfo(granule);
  t.deepEqual(result, granule);
});

test('(getGranuleProcessingTimeInfo() returns null for empty string endingDateTime', (t) => {
  const granule = {
    processingEndDateTime: '',
    processingStartDateTime: '2023-01-01T01:00:00.000Z',
  };
  const result = getGranuleProcessingTimeInfo(granule);
  t.deepEqual(result, {
    processingEndDateTime: null,
    processingStartDateTime: granule.processingStartDateTime,
  });
});

test('getGranuleProcessingTimeInfo() returns null for empty beginningDateTime', (t) => {
  const granule = {
    processingStartDateTime: '',
    processingEndDateTime: '2023-01-01T01:00:00.000Z',
  };
  const result = getGranuleProcessingTimeInfo(granule);
  t.deepEqual(result, {
    processingStartDateTime: null,
    processingEndDateTime: granule.processingEndDateTime,
  });
});

test('generateGranuleApiRecord() builds granule record with correct processing and temporal info', async (t) => {
  const {
    collectionId,
    provider,
    workflowStartTime,
    pdrName,
    workflowStatus,
    timestampExtraPrecision,
  } = t.context;
  const granule = t.context.granuleSuccess.payload.granules[0];
  const executionUrl = cryptoRandomString({ length: 10 });

  const processingTimeInfo = {
    processingStartDateTime: timestampExtraPrecision,
    processingEndDateTime: timestampExtraPrecision,
  };
  const cmrTemporalInfo = {
    beginningDateTime: timestampExtraPrecision,
    endingDateTime: timestampExtraPrecision,
    productionDateTime: timestampExtraPrecision,
    lastUpdateDateTime: timestampExtraPrecision,
  };

  const timeToArchive = getGranuleTimeToArchive(granule);
  const timeToPreprocess = getGranuleTimeToPreprocess(granule);
  const productVolume = getGranuleProductVolume(granule.files);
  const status = getGranuleStatus(workflowStatus, granule);
  const duration = getWorkflowDuration(workflowStartTime, Date.now());

  const record = await generateGranuleApiRecord({
    granule,
    executionUrl,
    processingTimeInfo,
    cmrTemporalInfo,
    collectionId,
    provider,
    pdrName,
    status,
    duration,
    cmrUtils: t.context.fakeCmrUtils,
    files: granule.files,
    timeToArchive,
    timeToPreprocess,
    productVolume,
  });

  t.is(record.beginningDateTime, new Date(cmrTemporalInfo.beginningDateTime).toISOString());
  t.is(record.endingDateTime, new Date(cmrTemporalInfo.endingDateTime).toISOString());
  t.is(record.productionDateTime, new Date(cmrTemporalInfo.productionDateTime).toISOString());
  t.is(record.lastUpdateDateTime, new Date(cmrTemporalInfo.lastUpdateDateTime).toISOString());

  t.is(
    record.processingStartDateTime,
    new Date(processingTimeInfo.processingStartDateTime).toISOString()
  );
  t.is(
    record.processingEndDateTime,
    new Date(processingTimeInfo.processingEndDateTime).toISOString()
  );
});

test('generateGranuleApiRecord() honors granule.createdAt if it exists', async (t) => {
  const {
    collectionId,
    provider,
    pdrName,
  } = t.context;

  const granule = t.context.granuleSuccess.payload.granules[0];
  const createdAt = Date.now();
  granule.createdAt = createdAt;
  const executionUrl = cryptoRandomString({ length: 10 });

  const record = await generateGranuleApiRecord({
    granule,
    executionUrl,
    collectionId,
    provider,
    pdrName,
    cmrUtils: t.context.fakeCmrUtils,
    files: granule.files,
  });

  t.is(record.createdAt, createdAt);
});

test('generateGranuleApiRecord() builds a failed granule record', async (t) => {
  const {
    collectionId,
    provider,
  } = t.context;
  const granule = t.context.granuleFailure.payload.granules[0];
  const executionUrl = cryptoRandomString({ length: 10 });
  const error = {
    Error: 'error',
    Cause: new Error('error'),
  };
  const status = getGranuleStatus('failed', granule);
  const record = await generateGranuleApiRecord({
    granule,
    executionUrl,
    provider,
    collectionId,
    status,
    error,
    cmrUtils: t.context.fakeCmrUtils,
    // in reality files comes from FileUtils.buildDatabaseFiles
    // and not the raw granule.files, but that functionality is tested
    // elsewhere and doesn't need to be re-verified here
    files: granule.files,
  });

  t.deepEqual(
    record.files,
    granule.files
  );
  t.is(record.status, 'failed');
  t.is(record.execution, executionUrl);
  t.is(record.granuleId, granule.granuleId);
  t.is(record.error.Error, error.Error);
  t.is(record.error.Cause, error.Cause);
});
