const test = require('ava');

const { randomId } = require('@cumulus/common/test-utils');

const { fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const Granule = require('../../../models/granules');

test.before(async (t) => {
  process.env.GranulesTable = randomId('granule');

  const granuleModel = new Granule();
  t.context.granuleModel = granuleModel;
  await granuleModel.createTable();
});

test.serial('_validateAndStoreGranuleRecord() can be used to create a new running granule', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    status: 'running'
  });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
});

test.serial('_validateAndStoreGranuleRecord() can be used to update a running execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2({
    status: 'running',
    createdAt: 123,
    updatedAt: 123,
    timestamp: 123
  });

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    createdAt: 456,
    updatedAt: 456,
    timestamp: 456,
    cmrLink: 'new-cmr-link'
  };
  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'running');
  t.is(fetchedItem.createdAt, 456);
  t.is(fetchedItem.updatedAt, 456);
  t.is(fetchedItem.timestamp, 456);
  // should not have been updated
  t.is(fetchedItem.cmrLink, granule.cmrLink);
});

test.serial('_validateAndStoreGranuleRecord() can be used to create a new completed execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});

test.serial('_validateAndStoreGranuleRecord() can be used to update a completed execution', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    productVolume: 500
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
  t.deepEqual(fetchedItem.productVolume, 500);
});

test.serial('_validateAndStoreGranuleRecord() will not allow a running status to replace a completed status', async (t) => {
  const { granuleModel } = t.context;

  const granule = fakeGranuleFactoryV2();

  await granuleModel._validateAndStoreGranuleRecord(granule);

  const updatedGranule = {
    ...granule,
    status: 'running'
  };

  await granuleModel._validateAndStoreGranuleRecord(updatedGranule);

  const fetchedItem = await granuleModel.get({ granuleId: granule.granuleId });

  t.is(fetchedItem.status, 'completed');
});
