'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const zlib = require('zlib');

const { s3 } = require('@cumulus/aws-client/services');
const {
  getObject,
  getObjectStreamBuffers,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  GranulePgModel,
  migrationDir,
  destroyLocalTestDb,
  generateLocalTestDb,
  localStackConnectionEnv,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
} = require('@cumulus/db');

const { handler } = require('../../lambdas/export-table');

const gunzip = (buffer) => zlib.gunzipSync(buffer).toString('utf-8');

test.before(async (t) => {
  t.context.testDbName = `export_table_${cryptoRandomString({ length: 10 })}`;
  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  // the handler calls getKnexClient() internally (no params), the same way
  // it will when actually invoked by the ECS async-operation runner, so it
  // reads its DB connection config from process.env rather than t.context
  Object.assign(process.env, localStackConnectionEnv, { PG_DATABASE: t.context.testDbName });

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();

  t.context.collection = fakeCollectionRecordFactory();
  const collectionResponse = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0].cumulus_id;
});

test.beforeEach(async (t) => {
  t.context.bucketsToCleanup = [];
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('bucket');
  process.env.stackName = t.context.stackName;
  process.env.system_bucket = t.context.systemBucket;
  await s3()
    .createBucket({ Bucket: t.context.systemBucket })
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));
});

test.afterEach.always(async (t) => {
  await Promise.all(t.context.bucketsToCleanup.map(recursivelyDeleteS3Bucket));
});

test.after.always(async (t) => {
  await destroyLocalTestDb({ ...t.context });
});

test.serial('export-table handler rejects an unsupported resourceType', async (t) => {
  await t.throwsAsync(
    handler({ resourceType: 'nope', asyncOperationId: randomId('async') }),
    { message: /Unsupported export resourceType/ }
  );
});

test.serial('export-table handler streams all matching granules to a gzipped CSV in S3', async (t) => {
  const testGranules = range(1200).map(() => fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
  }));
  await t.context.granulePgModel.insert(t.context.knex, testGranules);

  const asyncOperationId = randomId('async');
  const result = await handler({
    resourceType: 'granule',
    queryStringParameters: {},
    asyncOperationId,
  });

  t.is(result.rowCount, 1200);
  t.truthy(result.presignedS3Url);

  const key = `${t.context.stackName}/exports/granule/${asyncOperationId}.csv.gz`;
  const object = await getObject(s3(), { Bucket: t.context.systemBucket, Key: key });
  const buffers = await getObjectStreamBuffers(object.Body);
  const csv = gunzip(Buffer.concat(buffers));
  const rows = csv.trim().split('\n');

  // header + 1200 data rows, exceeding the 500-row pager batch size
  // (exercises multiple peek/shift pages, not just the first batch)
  t.is(rows.length, 1201);
  testGranules.slice(0, 3).forEach((g) => {
    t.true(csv.includes(g.granule_id));
  });
});

test.serial('export-table handler narrows the export using queryStringParameters filters', async (t) => {
  const matchingStatus = 'running';
  const matchingGranules = range(3).map(() => fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
    status: matchingStatus,
  }));
  const nonMatchingGranules = range(3).map(() => fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
    status: 'completed',
  }));
  await t.context.granulePgModel.insert(
    t.context.knex,
    [...matchingGranules, ...nonMatchingGranules]
  );

  const asyncOperationId = randomId('async');
  const result = await handler({
    resourceType: 'granule',
    queryStringParameters: { status: matchingStatus },
    asyncOperationId,
  });

  t.is(result.rowCount, 3);
});

test.serial('export-table handler succeeds with a defined empty-result shape when nothing matches', async (t) => {
  const asyncOperationId = randomId('async');
  const result = await handler({
    resourceType: 'granule',
    queryStringParameters: { status: 'this-status-does-not-exist' },
    asyncOperationId,
  });

  t.deepEqual(result, { presignedS3Url: null, rowCount: 0 });
});
