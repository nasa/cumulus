'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const s3Utils = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const {
  DeletePublishedGranule,
} = require('@cumulus/errors');

const { fakeFileFactory, fakeGranuleFactoryV2, fakeCollectionFactory } = require('../../../lib/testUtils');

const Manager = require('../../../models/base');

const GranulesModel = proxyquire(
  '../../../models/granules',
  {
    '@cumulus/db': {
      getKnexClient: () => getKnexClient({ env: localStackConnectionEnv }),
    },
  }
);

const bucket = randomId('bucket');
let granuleModel;
let removeGranuleFromCmrStub;

const dynamoCollectionToDbCollection = (dynamoCollection) => {
  const dbCollection = {
    ...dynamoCollection,
    created_at: new Date(dynamoCollection.createdAt),
    updated_at: new Date(dynamoCollection.updatedAt),
    granuleIdValidationRegex: dynamoCollection.granuleId,
    granuleIdExtractionRegex: dynamoCollection.granuleIdExtraction,
  };

  delete dbCollection.createdAt;
  delete dbCollection.updatedAt;
  delete dbCollection.granuleId;
  delete dbCollection.granuleIdExtraction;

  return dbCollection;
};

test.before(async (t) => {
  await s3Utils.createBucket(bucket);

  process.env.GranulesTable = randomId('granule');
  granuleModel = new GranulesModel();
  await granuleModel.createTable();

  removeGranuleFromCmrStub = sinon.stub(GranulesModel.prototype, '_removeGranuleFromCmr').resolves();

  t.context.db = await getKnexClient({ env: localStackConnectionEnv });

  const collectionRecord = dynamoCollectionToDbCollection(
    fakeCollectionFactory()
  );

  await t.context.db('collections').insert(collectionRecord);

  t.context.granuleCollectionFields = {
    dataType: collectionRecord.name,
    version: collectionRecord.version,
    collectionId: `${collectionRecord.name}___${collectionRecord.version}`,
  };
});

test.after.always(async () => {
  await Promise.all([
    s3Utils.recursivelyDeleteS3Bucket(bucket),
    granuleModel.deleteTable(),
  ]);
  removeGranuleFromCmrStub.restore();
});

test('granule.delete() removes granule files from S3 and record from Dynamo and RDS', async (t) => {
  const { db, granuleCollectionFields } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    files: [
      fakeFileFactory({ bucket }),
      fakeFileFactory({ bucket }),
    ],
    published: false,
  });
  await Promise.all(granule.files.map((file) => s3Utils.s3PutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: 'body',
  })));

  await granuleModel.create(granule);

  // Verify that the granule does exist in the DB
  t.true(await granuleModel.exists({ granuleId: granule.granuleId }));
  t.deepEqual(
    await Promise.all(granule.files.map((file) => s3Utils.s3ObjectExists({
      Bucket: file.bucket,
      Key: file.key,
    }))),
    [true, true]
  );

  t.not(
    await db('granules').first().where({ granuleId: granule.granuleId }),
    undefined
  );

  await granuleModel.delete({ db, granule });

  t.false(await granuleModel.exists({ granuleId: granule.granuleId }));
  t.deepEqual(
    await Promise.all(granule.files.map((file) => s3Utils.s3ObjectExists({
      Bucket: file.bucket,
      Key: file.key,
    }))),
    [false, false]
  );

  t.is(
    await db('granules').first().where({ granuleId: granule.granuleId }),
    undefined
  );
});

test('granule.delete() for deleted record should not throw error', async (t) => {
  const { db, granuleCollectionFields } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    published: false,
  });

  await granuleModel.create(granule);
  t.true(await granuleModel.exists({ granuleId: granule.granuleId }));

  await granuleModel.delete({ db, granule });
  t.false(await granuleModel.exists({ granuleId: granule.granuleId }));
  await t.notThrowsAsync(granuleModel.delete({ db, granule }));
});

test('granule.delete() throws error if granule is published', async (t) => {
  const { db, granuleCollectionFields } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    published: true,
  });

  await t.throwsAsync(
    granuleModel.delete({ db, granule }),
    {
      instanceOf: DeletePublishedGranule,
      message: 'You cannot delete a granule that is published to CMR. Remove it from CMR first',
    }
  );
});

test('granule.delete() with the old file format succeeds', async (t) => {
  const { db, granuleCollectionFields } = t.context;

  const granuleBucket = randomId('granuleBucket');

  const key = randomId('key');
  const newGranule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    published: false,
    files: [
      {
        filename: `s3://${granuleBucket}/${key}`,
      },
    ],
  });

  await s3Utils.createBucket(granuleBucket);
  t.teardown(() => s3Utils.recursivelyDeleteS3Bucket(granuleBucket));

  await s3Utils.s3PutObject({
    Bucket: granuleBucket,
    Key: key,
    Body: 'asdf',
  });

  // create a new unpublished granule
  const baseModel = new Manager({
    tableName: process.env.GranulesTable,
    tableHash: { name: 'granuleId', type: 'S' },
    tableAttributes: [{ name: 'collectionId', type: 'S' }],
    validate: false,
  });

  await baseModel.create(newGranule);

  await granuleModel.delete({ db, granule: newGranule });

  t.false(await granuleModel.exists({ granuleId: newGranule.granuleId }));
  // verify the file is deleted
  t.false(await s3Utils.s3ObjectExists({
    Bucket: granuleBucket,
    Key: key,
  }));
});

test('granule.unpublishAndDeleteGranule() deletes published granule', async (t) => {
  const { db, granuleCollectionFields } = t.context;

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    published: true,
  });

  await granuleModel.create(granule);

  t.true(await granuleModel.exists({ granuleId: granule.granuleId }));
  t.not(
    await db('granules').first().where({ granuleId: granule.granuleId }),
    undefined
  );

  await t.notThrowsAsync(
    granuleModel.unpublishAndDeleteGranule(granule)
  );
  t.true(removeGranuleFromCmrStub.called);
  t.false(await granuleModel.exists({ granuleId: granule.granuleId }));

  t.is(
    await db('granules').first().where({ granuleId: granule.granuleId }),
    undefined
  );
});

test.serial('granule.unpublishAndDeleteGranule() leaves granule.published = true if delete fails', async (t) => {
  const { granuleCollectionFields } = t.context;

  const deleteStub = sinon.stub(GranulesModel.prototype, '_deleteRecord').throws();
  t.teardown(() => deleteStub.restore());

  const granule = fakeGranuleFactoryV2({
    ...granuleCollectionFields,
    published: true,
  });

  await granuleModel.create(granule);

  await t.throwsAsync(
    granuleModel.unpublishAndDeleteGranule(granule)
  );
  const record = await granuleModel.get({ granuleId: granule.granuleId });
  t.true(record.published);
  t.truthy(record.cmrLink);
});
