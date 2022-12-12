const test = require('ava');

const S3 = require('@cumulus/aws-client/S3');
const awsClients = require('@cumulus/aws-client/services');
const cmrUtils = require('@cumulus/cmrjs/cmr-utils');
const { buildURL } = require('@cumulus/common/URLUtils');
const { randomId } = require('@cumulus/common/test-utils');
const { getGranuleStatus, generateGranuleApiRecord } = require('@cumulus/message/Granules');

const cloneDeep = require('lodash/cloneDeep');
const omitBy = require('lodash/omitBy');
const isNull = require('lodash/isNull');

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const Granule = require('../../../models/granules');

test.before(async (t) => {
  process.env.GranulesTable = randomId('granule');

  const fakeStepFunctionUtils = {
    describeExecution: () => Promise.resolve({}),
  };
  const fakeCmrUtils = {
    getGranuleTemporalInfo: () => Promise.resolve({}),
  };

  const granuleModel = new Granule({
    cmrUtils: fakeCmrUtils,
    stepFunctionUtils: fakeStepFunctionUtils,
  });
  t.context.granuleModel = granuleModel;
  await granuleModel.createTable();
});

test.beforeEach((t) => {
  t.context.collectionId = randomId('collection');
  t.context.provider = {
    name: randomId('name'),
    protocol: 's3',
    host: randomId('host'),
  };
  t.context.workflowStartTime = Date.now();
  t.context.workflowStatus = 'completed';
});

const setNullableKeysToNull = (granule, granuleModel) => {
  const updatedGranule = cloneDeep(granule);
  Object.keys(updatedGranule).forEach((key) => {
    if (!granuleModel.invalidNullFields.includes(key)) {
      updatedGranule[key] = null;
    }
  });
  return updatedGranule;
};

test('_storeGranuleRecord() throws ValidateError on overwrite with invalid nullable keys', async (t) => {
  // Granule record update in running status with write constraints set to false
  // allows changes to all fields

  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'complete' });

  await granuleModel._storeGranuleRecord(granule);

  await Promise.all(granuleModel.invalidNullFields.map(async (field) => {
    const updateGranule = {
      ...granule,
    };
    updateGranule[field] = null;
    console.log(`Running ${field} test`);
    await t.throwsAsync(granuleModel._storeGranuleRecord(updateGranule, false), { name: 'ValidationError' });
  }));
});

test('_storeGranuleRecord() adds a new record, with nulls omitted', async (t) => {
  // Granule record update in running status only allows changes to
  // ['createdAt', 'updatedAt', 'timestamp', 'status', 'execution']

  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'complete' });
  const updatedGranule = {
    ...setNullableKeysToNull(granule, granuleModel),
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, omitBy(updatedGranule, isNull));
});

test('_storeGranuleRecord() removes only expected fields for running granule record on overwrite when write constraints are set to true and granule is expected to write', async (t) => {
  // Granule record update in running status only allows changes to
  // ['createdAt', 'updatedAt', 'timestamp', 'status', 'execution']

  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'complete' });

  await granuleModel._storeGranuleRecord(granule);

  const updateDate = Date.now();
  const updateValues = {
    createdAt: updateDate,
    updatedAt: updateDate,
    timestamp: updateDate,
    execution: 'totallyARealExecutionArn',
    status: 'running',
  };
  const updatedGranule = {
    ...setNullableKeysToNull(granule, granuleModel),
    ...updateValues,
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, { ...granule, ...updateValues });
});

test('_storeGranuleRecord() removes only expected fields for running granule record on overwrite when write constraints are set to false and granule is expected to write', async (t) => {
  // Granule record update in running status with write constraints set to false
  // allows changes to all fields

  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'complete' });

  await granuleModel._storeGranuleRecord(granule);

  const updateDate = Date.now();
  const updateValues = {
    createdAt: updateDate,
    updatedAt: updateDate,
    timestamp: updateDate,
    execution: 'totallyARealExecutionArn',
    status: 'running',
  };
  const updatedGranule = {
    ...setNullableKeysToNull(granule, granuleModel),
    ...updateValues,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, omitBy(updatedGranule, isNull));
});

test('_storeGranuleRecord() removes only expected fields for queued granule record on overwrite when write constraints are set to true and granule is expected to write', async (t) => {
  // Granule record update in queued status allows changes to all fields
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'complete' });

  await granuleModel._storeGranuleRecord(granule);

  const updateDate = Date.now();
  const updateValues = {
    createdAt: updateDate,
    updatedAt: updateDate,
    timestamp: updateDate,
    execution: 'totallyARealExecutionArn',
    status: 'queued',
  };
  const updatedGranule = {
    ...setNullableKeysToNull(granule, granuleModel),
    ...updateValues,
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, omitBy(updatedGranule, isNull));
});

test('_storeGranuleRecord() removes only expected fields for queued granule record on overwrite when write constraints are set to false and granule is expected to write', async (t) => {
  // Granule record update in queued status allows changes to all fields
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'complete' });

  await granuleModel._storeGranuleRecord(granule);

  const updateDate = Date.now();
  const updateValues = {
    createdAt: updateDate,
    updatedAt: updateDate,
    timestamp: updateDate,
    execution: 'totallyARealExecutionArn',
    status: 'queued',
  };
  const updatedGranule = {
    ...setNullableKeysToNull(granule, granuleModel),
    ...updateValues,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, omitBy(updatedGranule, isNull));
});

test('_storeGranuleRecord() removes expected fields for final state granule record on overwrite when write constraints are set to true and granule is expected to write', async (t) => {
  // Granule record update in final (running/failed) status allows changes to all fields

  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'complete' });

  await granuleModel._storeGranuleRecord(granule);

  const updateDate = Date.now();
  const updateValues = {
    createdAt: updateDate,
    updatedAt: updateDate,
    timestamp: updateDate,
    execution: 'totallyARealExecutionArn',
    status: 'complete',
  };
  const updatedGranule = {
    ...setNullableKeysToNull(granule, granuleModel),
    ...updateValues,
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, omitBy(updatedGranule, isNull));
});

test('_storeGranuleRecord() removes expected fields for final state granule record when write constraints are set to false and granule is expected to write', async (t) => {
  // Granule record update in final (running/failed) status allows changes to all fields

  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'complete' });

  await granuleModel._storeGranuleRecord(granule);

  const updateDate = Date.now();
  const updateValues = {
    createdAt: updateDate,
    updatedAt: updateDate,
    timestamp: updateDate,
    execution: 'totallyARealExecutionArn',
    status: 'complete',
  };
  const updatedGranule = {
    ...setNullableKeysToNull(granule, granuleModel),
    ...updateValues,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, omitBy(updatedGranule, isNull));
});

test('_storeGranuleRecord() can be used to create a new running granule when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    status: 'running',
  });

  await granuleModel._storeGranuleRecord(granule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test('_storeGranuleRecord() can be used to create a new running granule when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    status: 'running',
  });

  await granuleModel._storeGranuleRecord(granule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test('_storeGranuleRecord() can be used to create a new completed granule when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test('_storeGranuleRecord() can be used to create a new completed granule when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test('_storeGranuleRecord() can be used to create a new failed granule when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
  t.deepEqual(fetchedItem, granule);
});

test('_storeGranuleRecord() can be used to create a new failed granule when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
  t.deepEqual(fetchedItem, granule);
});

test('_storeGranuleRecord() can be used to create a new queued granule when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    status: 'queued',
  });

  await granuleModel._storeGranuleRecord(granule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'queued');
  t.deepEqual(fetchedItem, granule);
});

test('_storeGranuleRecord() can be used to create a new queued granule when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    status: 'queued',
  });

  await granuleModel._storeGranuleRecord(granule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'queued');
  t.deepEqual(fetchedItem, granule);
});

test('_storeGranuleRecord() can be used to update a completed granule when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    productVolume: '500',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() can be used to update a completed granule when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    productVolume: '500',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() can be used to update a failed granule when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);

  const newError = { cause: 'fail' };
  const updatedGranule = {
    ...granule,
    error: newError,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
  t.deepEqual(fetchedItem.error, newError);
  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() can be used to update a failed granule  when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule, false);

  const newError = { cause: 'fail' };
  const updatedGranule = {
    ...granule,
    error: newError,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'failed');
  t.deepEqual(fetchedItem.error, newError);
  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() will allow a completed status to replace a running status for same execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() will allow a completed status to replace a running status for same execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() will allow a failed status to replace a running status for same execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'failed',
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() will allow a failed status to replace a running status for same execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'failed',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() will not allow a running status to replace a completed status for same execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, granule);
});

test('_storeGranuleRecord() will allow a running status to replace a completed status for same execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() will not allow a running status to replace a failed status for same execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await t.notThrowsAsync(granuleModel._storeGranuleRecord(updatedGranule, true));

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, granule);
});

test('_storeGranuleRecord() will allow a running status to replace a failed status for same execution  when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_storeGranuleRecord() will allow a running status to replace a completed status for a new execution when writeConstraints is set to true ', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a running status to replace a completed status for a new execution when writeConstraints is set to false ', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a running status to replace a failed status for a new execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a running status to replace a failed status for a new execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a completed status to replace a queued status for a new execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'queued' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'completed',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'completed',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a completed status to replace a queued status for a new execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'queued' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'completed',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'completed',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a running status to replace a queued status for a new execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'queued' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a running status to replace a queued status for a new execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'queued' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'running',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a running status to replace a queued status for the same execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'queued' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    status: 'running',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
      createdAt: updateTime,
    }
  );
});

test('_storeGranuleRecord() will allow a running status to replace a queued status for the same execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'queued' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    status: 'running',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
      createdAt: updateTime,
    }
  );
});

test('_storeGranuleRecord() will allow a queued status to replace a running status for a new execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'queued',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'queued',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will allow a queued status to replace a running status for a new execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);
  const updateTime = Date.now();

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'queued',
    createdAt: updateTime,
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'queued',
      createdAt: updateTime,
      execution: 'new-execution-url',
    }
  );
});

test('_storeGranuleRecord() will not allow a queued status to replace running for same execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'running',
    }
  );
});

test('_storeGranuleRecord() will allow a queued status to replace running for same execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'running' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    updatedGranule
  );
});

test('_storeGranuleRecord() will not allow a queued status to replace completed/failed for same execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'completed' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granuleModel._storeGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'completed',
    }
  );
});

test('_storeGranuleRecord() will allow a queued status to replace completed/failed for same execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'completed' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    updatedGranule
  );
});

test('_storeGranuleRecord() will allow a queued status to replace completed/failed for new execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'completed' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'queued',
    execution: 'newExecution',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    updatedGranule
  );
});

test('_storeGranuleRecord() will allow a queued status to replace completed/failed new new execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'completed' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'queued',
    execution: 'newExecution',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    updatedGranule
  );
});

test('_storeGranuleRecord() will allow a completed status to replace queued for same execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'queued' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'completed',
    }
  );
});

test('_storeGranuleRecord() will allow a completed status to replace queued for same execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'queued' });

  await granuleModel._storeGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granuleModel._storeGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      status: 'completed',
    }
  );
});

test('_storeGranuleRecord() writes a new granule record with undefined files if files is set to []', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ files: [] });

  await granuleModel._storeGranuleRecord(granule);
  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.files, undefined);
});

test('_storeGranuleRecord() writes a new granule record with undefined files if files is set to undefined', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  delete granule.files;

  await granuleModel._storeGranuleRecord(granule);
  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.files, undefined);
});

test('_storeGranuleRecord() overwrites a new granule record and deletes files if files is set to [] and write constraints are set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  delete granule.files;

  await granuleModel._storeGranuleRecord(granule, false);
  granule.files = [];
  await granuleModel._storeGranuleRecord(granule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });
  t.is(fetchedItem.files, undefined);
});

test('_storeGranuleRecord() overwrites a new granule record and deletes files if files is set to [] and write constraints are set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  delete granule.files;

  await granuleModel._storeGranuleRecord(granule, false);
  granule.files = [];
  await granuleModel._storeGranuleRecord(granule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });
  t.is(fetchedItem.files, undefined);
});

test('_validateAndStoreGranuleRecord() will not allow a final status for an older execution to replace a running status for a newer execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const timeVal = Date.now();

  const granule = fakeGranuleFactoryV2();

  const originalGranule = {
    ...granule,
    createdAt: timeVal + 1000000,
    status: 'running',
  };

  await granuleModel._validateAndStoreGranuleRecord(originalGranule);

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'failed',
  };

  await t.notThrowsAsync(granuleModel._validateAndStoreGranuleRecord(updatedGranule, true));

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, originalGranule);
});

test('_validateAndStoreGranuleRecord() will allow a final status for an older execution to replace a running status for a newer execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const timeVal = Date.now();

  const granule = fakeGranuleFactoryV2();

  const originalGranule = {
    ...granule,
    createdAt: timeVal + 1000000,
    status: 'running',
  };

  await granuleModel._validateAndStoreGranuleRecord(originalGranule);

  const updatedGranule = {
    ...granule,
    execution: 'new-execution-url',
    status: 'failed',
  };

  await t.notThrowsAsync(granuleModel._validateAndStoreGranuleRecord(updatedGranule, false));

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_validateAndStoreGranuleRecord() will not allow a final status for an older execution to replace a final status for a newer execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const timeVal = Date.now();

  const granule = fakeGranuleFactoryV2();

  const originalGranule = {
    ...granule,
    createdAt: timeVal + 1000000,
    status: 'completed',
  };

  await granuleModel._validateAndStoreGranuleRecord(originalGranule);

  const updatedGranule = {
    ...granule,
    execution: 'alt-execution-url',
    status: 'failed',
  };

  await t.notThrowsAsync(granuleModel._validateAndStoreGranuleRecord(updatedGranule, true));

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });
  t.deepEqual(fetchedItem, originalGranule);
});

test('_validateAndStoreGranuleRecord() will allow a final status for an older execution to replace a final status for a newer execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const timeVal = Date.now();

  const granule = fakeGranuleFactoryV2();

  const originalGranule = {
    ...granule,
    createdAt: timeVal + 1000000,
    status: 'completed',
  };

  await granuleModel._validateAndStoreGranuleRecord(originalGranule);

  const updatedGranule = {
    ...granule,
    execution: 'alt-execution-url',
    status: 'failed',
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });
  t.deepEqual(fetchedItem, updatedGranule);
});

test('_validateAndStoreGranuleRecord() will allow a running status for an newer execution to update only expected fields if write constraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const timeVal = Date.now();

  const granule = fakeGranuleFactoryV2();

  const originalGranule = {
    ...granule,
    createdAt: timeVal + 1000000,
    status: 'completed',
  };

  await granuleModel._validateAndStoreGranuleRecord(originalGranule);

  const updatedGranule = {
    ...granule,
    createdAt: originalGranule.createdAt + 1,
    updatedAt: 1,
    timestamp: 1,
    status: 'running',
    cmrLink: 'updatedLink',
    execution: 'newExecution',
    duration: 100,
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });
  t.deepEqual(
    fetchedItem,
    {
      ...granule,
      createdAt: updatedGranule.createdAt,
      updatedAt: updatedGranule.updatedAt,
      timestamp: updatedGranule.timestamp,
      status: 'running',
      execution: updatedGranule.execution,
    }
  );
});

test('_validateAndStoreGranuleRecord() will allow a running status for an newer execution to update all fields if write constraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const timeVal = Date.now();

  const granule = fakeGranuleFactoryV2();

  const originalGranule = {
    ...granule,
    createdAt: timeVal + 1000000,
    status: 'completed',
  };

  await granuleModel._validateAndStoreGranuleRecord(originalGranule);

  const updatedGranule = {
    ...granule,
    createdAt: originalGranule.createdAt + 1,
    updatedAt: 1,
    timestamp: 1,
    status: 'running',
    cmrLink: 'updatedLink',
    execution: 'newExecution',
    duration: 100,
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });
  t.deepEqual(
    fetchedItem,
    updatedGranule
  );
});

test('_validateAndStoreGranuleRecord() will allow a final status for a new execution to replace a final status for an older execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord({
    ...granule,
    status: 'completed',
  });

  const updatedGranule = {
    ...granule,
    createdAt: Date.now(),
    execution: 'alt-execution-url',
    status: 'failed',
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule, true);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_validateAndStoreGranuleRecord() will allow a final status for a new execution to replace a final status for an older execution when writeConstraints is set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord({
    ...granule,
    status: 'completed',
  });

  const updatedGranule = {
    ...granule,
    createdAt: Date.now(),
    execution: 'alt-execution-url',
    status: 'failed',
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule, false);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(fetchedItem, updatedGranule);
});

test('_validateAndStoreGranuleRecord() throws validation error when an invalid granule object is passed', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();
  // granule without granuleId should fail validation
  delete granule.granuleId;

  await t.throwsAsync(granuleModel._validateAndStoreGranuleRecord(granule));
});

test('_validateAndStoreGranuleRecord() does not update record if trying to update granule to failed -> running without a new execution when writeConstraints is set to true', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule, true);

  const result = await granuleModel.get({ granuleId: granule.granuleId });
  t.like(granule, result);
});

test('_validateAndStoreGranuleRecord updates record if trying to update granule to failed -> running without a new execution and writeConstraints are set to false', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({ status: 'failed' });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule, false);
  const result = await granuleModel.get({ granuleId: granule.granuleId });
  t.like(updatedGranule, result);
});

test('storeGranule() correctly stores granule record', async (t) => {
  const {
    granuleModel,
    collectionId,
    provider,
    workflowStatus,
  } = t.context;

  const bucket = randomId('bucket');
  await S3.createBucket(bucket);
  t.teardown(() => S3.recursivelyDeleteS3Bucket(bucket));

  const granule1 = fakeGranuleFactoryV2({
    files: [fakeFileFactory({ bucket })],
  });

  await S3.s3PutObject({ Bucket: bucket, Key: granule1.files[0].key, Body: 'asdf' });

  const files = await granuleModel.fileUtils.buildDatabaseFiles({
    s3: awsClients.s3(),
    providerURL: buildURL(provider),
    files: granule1.files,
  });

  const granuleRecord = await generateGranuleApiRecord({
    granule: granule1,
    files,
    executionUrl: 'http://execution-url.com',
    collectionId,
    provider: provider.id,
    workflowStatus,
    status: getGranuleStatus(workflowStatus, granule1),
    cmrUtils,
    updatedAt: Date.now(),
  });
  await granuleModel.storeGranule(granuleRecord);
  const result = await granuleModel.get({ granuleId: granuleRecord.granuleId });

  t.deepEqual(result, granuleRecord);
});

test('storeGranule() correctly stores files on empty array update', async (t) => {
  const {
    granuleModel,
    collectionId,
    provider,
    workflowStatus,
  } = t.context;

  const bucket = randomId('bucket');
  await S3.createBucket(bucket);
  t.teardown(() => S3.recursivelyDeleteS3Bucket(bucket));

  const granule1 = fakeGranuleFactoryV2({
    files: [fakeFileFactory({ bucket })],
  });

  await S3.s3PutObject({ Bucket: bucket, Key: granule1.files[0].key, Body: 'asdf' });

  const files = await granuleModel.fileUtils.buildDatabaseFiles({
    s3: awsClients.s3(),
    providerURL: buildURL(provider),
    files: granule1.files,
  });

  const granuleRecord = await generateGranuleApiRecord({
    granule: granule1,
    files,
    executionUrl: 'http://execution-url.com',
    collectionId,
    provider: provider.id,
    workflowStatus,
    status: getGranuleStatus(workflowStatus, granule1),
    cmrUtils,
    updatedAt: Date.now(),
  });
  await granuleModel.storeGranule(granuleRecord);
  granuleRecord.files = files;
  await granuleModel.storeGranule({ ...granuleRecord, files: [] });
  const result = await granuleModel.get({ granuleId: granuleRecord.granuleId });

  delete granuleRecord.files;
  t.deepEqual(result, granuleRecord);
});

test('storeGranule() does not update files when files are not mutable and write constraints are set to true', async (t) => {
  const {
    granuleModel,
    collectionId,
    provider,
    workflowStatus,
  } = t.context;

  const bucket = randomId('bucket');
  await S3.createBucket(bucket);
  t.teardown(() => S3.recursivelyDeleteS3Bucket(bucket));

  const granule1 = fakeGranuleFactoryV2({
    files: [fakeFileFactory({ bucket })],
  });

  await S3.s3PutObject({ Bucket: bucket, Key: granule1.files[0].key, Body: 'asdf' });

  const files = await granuleModel.fileUtils.buildDatabaseFiles({
    s3: awsClients.s3(),
    providerURL: buildURL(provider),
    files: granule1.files,
  });

  const granuleRecord = await generateGranuleApiRecord({
    granule: granule1,
    files,
    executionUrl: 'http://execution-url.com',
    collectionId,
    provider: provider.id,
    workflowStatus,
    status: getGranuleStatus(workflowStatus, granule1),
    cmrUtils,
    updatedAt: Date.now(),
  });
  await granuleModel.storeGranule(granuleRecord, true);
  granuleRecord.files = files;
  await granuleModel.storeGranule({ ...granuleRecord, files: [], status: 'running' });
  const result = await granuleModel.get({ granuleId: granuleRecord.granuleId });

  t.deepEqual(result, granuleRecord);
  t.deepEqual(result.files, files);
});
