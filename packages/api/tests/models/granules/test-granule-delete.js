'use strict';

const test = require('ava');
const sinon = require('sinon');

const s3Utils = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const {
  DeletePublishedGranule,
} = require('@cumulus/errors');

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const models = require('../../../models');

const bucket = randomId('bucket');
let granuleModel;
let removeGranuleFromCmrStub;

test.before(async () => {
  await s3Utils.createBucket(bucket);

  process.env.GranulesTable = randomId('granule');
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  removeGranuleFromCmrStub = sinon.stub(models.Granule.prototype, '_removeGranuleFromCmr').resolves();
});

test.after.always(async () => {
  await Promise.all([
    s3Utils.recursivelyDeleteS3Bucket(bucket),
    granuleModel.deleteTable(),
  ]);
  removeGranuleFromCmrStub.restore();
});

test('granule.delete() removes granule record from Dynamo', async (t) => {
  const granule = fakeGranuleFactoryV2({
    files: [
      fakeFileFactory({ bucket }),
      fakeFileFactory({ bucket }),
    ],
    published: false,
  });

  await granuleModel.create(granule);
  t.true(await granuleModel.exists({ granuleId: granule.granuleId }));

  await granuleModel.delete(granule);
  t.false(await granuleModel.exists({ granuleId: granule.granuleId }));
});

test('granule.delete() for deleted record should not throw error', async (t) => {
  const granule = fakeGranuleFactoryV2({
    published: false,
  });

  await granuleModel.create(granule);
  t.true(await granuleModel.exists({ granuleId: granule.granuleId }));

  await granuleModel.delete(granule);
  t.false(await granuleModel.exists({ granuleId: granule.granuleId }));
  await t.notThrowsAsync(granuleModel.delete(granule));
});

test('granule.delete() throws error if granule is published', async (t) => {
  const granule = fakeGranuleFactoryV2({
    published: true,
  });

  await t.throwsAsync(
    granuleModel.delete(granule),
    {
      instanceOf: DeletePublishedGranule,
      message: 'You cannot delete a granule that is published to CMR. Remove it from CMR first',
    }
  );
});

test('granule.delete() with the old file format succeeds', async (t) => {
  const granuleBucket = randomId('granuleBucket');

  const key = randomId('key');
  const newGranule = fakeGranuleFactoryV2({
    published: false,
    files: [
      {
        filename: `s3://${granuleBucket}/${key}`,
      },
    ],
  });

  // create a new unpublished granule
  const baseModel = new models.Manager({
    tableName: process.env.GranulesTable,
    tableHash: { name: 'granuleId', type: 'S' },
    tableAttributes: [{ name: 'collectionId', type: 'S' }],
    validate: false,
  });

  await baseModel.create(newGranule);

  await granuleModel.delete(newGranule);

  t.false(await granuleModel.exists({ granuleId: newGranule.granuleId }));
});
