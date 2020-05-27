'use strict';

const cloneDeep = require('lodash/cloneDeep');
const test = require('ava');

const s3Utils = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const Granule = require('../../../models/granules');

const bucket = randomId('bucket');
let granuleModel;

test.before(async () => {
  await s3Utils.createBucket(bucket);

  process.env.GranulesTable = randomId('granule');
  granuleModel = new Granule();
  await granuleModel.createTable();
});

test.after.always(async () => {
  await Promise.all([
    s3Utils.recursivelyDeleteS3Bucket(bucket),
    granuleModel.deleteTable()
  ]);
});

test('granule.delete() removes granule files from S3 and record from Dynamo', async (t) => {
  const granule = fakeGranuleFactoryV2({
    files: [
      fakeFileFactory({ bucket }),
      fakeFileFactory({ bucket })
    ],
    published: false
  });
  await Promise.all(granule.files.map((file) => s3Utils.s3PutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: 'body'
  })));

  await granuleModel.create(granule);
  t.true(await granuleModel.exists({ granuleId: granule.granuleId }));
  t.deepEqual(
    await Promise.all(granule.files.map((file) => s3Utils.fileExists(
      file.bucket,
      file.key
    ))),
    [true, true]
  );

  await granuleModel.delete(granule);
  t.false(await granuleModel.exists({ granuleId: granule.granuleId }));
  t.deepEqual(
    await Promise.all(granule.files.map((file) => s3Utils.fileExists(
      file.bucket,
      file.key
    ))),
    [false, false]
  );
});
