'use strict';

const test = require('ava');
const knex = require('knex');
const cryptoRandomString = require('crypto-random-string');
const random = require('lodash/random');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  createDuckDBTables,
  setupDuckDBWithS3ForTesting,
  stageAndLoadDuckDBTableFromData,
} = require('../../dist/test-duckdb-utils');
const { CollectionS3Search } = require('../../dist/s3search/CollectionS3Search');
const {
  collectionsS3TableSql,
  granulesS3TableSql,
  providersS3TableSql,
} = require('../../dist/s3search/s3TableSchemas');

const {
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
} = require('../../dist');

test.before(async (t) => {
  t.context.knexBuilder = knex({ client: 'pg' });
  t.context.collectionSearchTmestamp = 1579352700000;

  const collections = range(100).map((num) => (
    fakeCollectionRecordFactory({
      name: num % 2 === 0 ? 'testCollection' : 'fakeCollection',
      version: num,
      cumulus_id: num,
      updated_at: new Date(t.context.collectionSearchTmestamp + (num % 2)),
      process: num % 2 === 0 ? 'ingest' : 'publish',
      report_to_ems: num % 2 === 0,
      url_path: num % 2 === 0 ? 'https://fakepath.com' : undefined,
      granule_id_validation_regex: num % 2 === 0 ? 'testGranuleId' : 'fakeGranuleId',
    })
  ));

  // Create provider
  t.context.provider = fakeProviderRecordFactory({
    cumulus_id: random(1, 100),
  });

  const statuses = ['queued', 'failed', 'completed', 'running'];
  t.context.granuleSearchTmestamp = 1688888800000;
  t.context.granules = range(1000).map((num) => (
    fakeGranuleRecordFactory({
      // collection with cumulus_id 0-9 each has 11 granules,
      // collection 10-98 has 10 granules, and collection 99 has 0 granule
      collection_cumulus_id: num % 99,
      cumulus_id: 100 + num,
      // when collection_cumulus_id is odd number(1,3,5...97), its granules have provider
      provider_cumulus_id: (num % 99 % 2) ? t.context.provider.cumulus_id : undefined,
      status: statuses[num % 4],
      // granule with collection_cumulus_id n has timestamp granuleSearchTmestamp + n,
      // except granule 98 (with collection 98 ) which has timestamp granuleSearchTmestamp - 1
      updated_at: num === 98
        ? new Date(t.context.granuleSearchTmestamp - 1)
        : new Date(t.context.granuleSearchTmestamp + (num % 99)),
    })
  ));

  const { instance, connection } = await setupDuckDBWithS3ForTesting();
  t.context.instance = instance;
  t.context.connection = connection;

  t.context.testBucket = cryptoRandomString({ length: 10 });
  await s3().createBucket({ Bucket: t.context.testBucket });
  await createDuckDBTables(connection);

  const duckdbS3Prefix = `s3://${t.context.testBucket}/duckdb/`;

  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'collections',
    collectionsS3TableSql,
    collections,
    `${duckdbS3Prefix}collections.parquet`
  );

  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'providers',
    providersS3TableSql,
    t.context.provider,
    `${duckdbS3Prefix}providers.parquet`
  );

  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'granules',
    granulesS3TableSql,
    t.context.granules,
    `${duckdbS3Prefix}granules.parquet`
  );
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.testBucket);
  await t.context.connection.closeSync();
});

test.serial('CollectionS3Search returns 10 collections by default', async (t) => {
  const { connection } = t.context;
  const dbSearch = new CollectionS3Search({}, connection);
  const results = await dbSearch.query();
  t.is(results.meta.count, 100);
  t.is(results.results.length, 10);
  // TODO verify the query result json objects
});

test.serial('CollectionSearch supports page and limit params', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 20,
    page: 2,
  };
  let dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 11,
    page: 10,
  };
  dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 0);
});

test.serial('CollectionSearch supports infix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 20,
    infix: 'test',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 20);
});

test.serial('CollectionSearch supports prefix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 20,
    prefix: 'fake',
  };
  const dbSearch2 = new CollectionS3Search({ queryStringParameters }, connection);
  const response2 = await dbSearch2.query();
  t.is(response2.meta.count, 50);
  t.is(response2.results?.length, 20);
});

test.serial('CollectionSearch supports term search for boolean field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    reportToEms: 'false',
  };
  const dbSearch4 = new CollectionS3Search({ queryStringParameters }, connection);
  const response4 = await dbSearch4.query();
  t.is(response4.meta.count, 50);
  t.is(response4.results?.length, 50);
});

test.serial('CollectionSearch supports term search for date field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    updatedAt: `${t.context.collectionSearchTmestamp + 1}`,
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('CollectionSearch supports term search for number field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    version: '2',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('CollectionSearch supports term search for string field', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    _id: 'fakeCollection___71',
  };
  const dbSearch2 = new CollectionS3Search({ queryStringParameters }, connection);
  const response2 = await dbSearch2.query();
  t.is(response2.meta.count, 1);
  t.is(response2.results?.length, 1);

  queryStringParameters = {
    limit: 200,
    process: 'publish',
  };
  const dbSearch3 = new CollectionS3Search({ queryStringParameters }, connection);
  const response3 = await dbSearch3.query();
  t.is(response3.meta.count, 50);
  t.is(response3.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    granuleId: 'testGranuleId',
  };
  const dbSearch4 = new CollectionS3Search({ queryStringParameters }, connection);
  const response4 = await dbSearch4.query();
  t.is(response4.meta.count, 50);
  t.is(response4.results?.length, 50);
});

test.serial('CollectionSearch supports range search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    timestamp__from: `${t.context.collectionSearchTmestamp + 1}`,
    timestamp__to: `${t.context.collectionSearchTmestamp + 2}`,
  };
  let dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    ...queryStringParameters,
    active: 'true',
  };
  dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test.serial('CollectionSearch supports search for multiple fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    name: 'testCollection',
    version: '0',
    updatedAt: `${t.context.collectionSearchTmestamp}`,
    process: 'ingest',
    reportToEms: 'true',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('CollectionSearch non-existing fields are ignored', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test.serial('CollectionSearch returns fields specified', async (t) => {
  const { connection } = t.context;
  const fields = 'name,version,reportToEms,process';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 10);
  response.results.forEach((collection) => t.deepEqual(Object.keys(collection), fields.split(',')));
});

test.serial('CollectionSearch supports sorting', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    sort_by: 'name',
    order: 'asc',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.true(response.results[0].name < response.results[99].name);
  t.true(response.results[0].name < response.results[50].name);

  queryStringParameters = {
    limit: 200,
    sort_key: ['-name'],
  };
  const dbSearch2 = new CollectionS3Search({ queryStringParameters }, connection);
  const response2 = await dbSearch2.query();
  t.is(response2.meta.count, 100);
  t.is(response2.results?.length, 100);
  t.true(response2.results[0].name > response2.results[99].name);
  t.true(response2.results[0].name > response2.results[50].name);

  queryStringParameters = {
    limit: 200,
    sort_by: 'version',
  };
  const dbSearch3 = new CollectionS3Search({ queryStringParameters }, connection);
  const response3 = await dbSearch3.query();
  t.is(response3.meta.count, 100);
  t.is(response3.results?.length, 100);
  t.true(response3.results[0].version < response3.results[99].version);
  t.true(response3.results[49].version < response3.results[50].version);
});

test.serial('CollectionSearch supports terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    process__in: ['ingest', 'archive'].join(','),
  };
  let dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    process__in: ['ingest', 'archive'].join(','),
    _id__in: ['testCollection___0', 'fakeCollection___1'].join(','),
  };
  dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 200,
    granuleId__in: ['testGranuleId', 'non-existent'].join(','),
  };
  dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('CollectionSearch supports search when collection field does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    process__not: 'publish',
  };
  let dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    process__not: 'publish',
    version__not: 18,
  };
  dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test.serial('CollectionSearch supports search which checks existence of collection field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    url_path__exists: 'true',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('CollectionSearch supports includeStats', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeStats: 'true',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  const expectedStats0 = { queued: 3, completed: 3, failed: 2, running: 3, total: 11 };
  const expectedStats98 = { queued: 2, completed: 3, failed: 3, running: 2, total: 10 };
  const expectedStats99 = { queued: 0, completed: 0, failed: 0, running: 0, total: 0 };

  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.deepEqual(response.results[0].stats, expectedStats0);
  t.deepEqual(response.results[98].stats, expectedStats98);
  t.deepEqual(response.results[99].stats, expectedStats99);
});

test.serial('CollectionSearch supports search for active collections', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: '200',
    active: 'true',
    includeStats: 'true',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  const expectedStats0 = { queued: 3, completed: 3, failed: 2, running: 3, total: 11 };
  const expectedStats10 = { queued: 2, completed: 3, failed: 3, running: 2, total: 10 };
  const expectedStats98 = { queued: 2, completed: 3, failed: 3, running: 2, total: 10 };
  t.is(response.meta.count, 99);
  t.is(response.results?.length, 99);
  t.deepEqual(response.results[0].stats, expectedStats0);
  t.deepEqual(response.results[10].stats, expectedStats10);
  t.deepEqual(response.results[98].stats, expectedStats98);
});

test.serial('CollectionSearch supports search for active collections by infix/prefix', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: '200',
    active: 'true',
    includeStats: 'true',
    infix: 'Collection',
    prefix: 'fake',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  // collection_cumulus_id 1
  const expectedStats0 = { queued: 3, completed: 2, failed: 3, running: 3, total: 11 };
  // collection_cumulus_id 97
  const expectedStats48 = { queued: 3, completed: 2, failed: 3, running: 2, total: 10 };

  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
  t.deepEqual(response.results[0].stats, expectedStats0);
  t.deepEqual(response.results[48].stats, expectedStats48);
});

test.serial('CollectionSearch support search for active collections and stats with granules updated in the given time frame', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: '200',
    active: 'true',
    includeStats: 'true',
    timestamp__from: `${t.context.granuleSearchTmestamp + 10}`,
    timestamp__to: `${t.context.granuleSearchTmestamp + 98}`,
    sort_by: 'version',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  const expectedStats0 = { queued: 2, completed: 3, failed: 3, running: 2, total: 10 };
  // collection with cumulus_id 98 has 9 granules in the time frame
  const expectedStats98 = { queued: 2, completed: 2, failed: 3, running: 2, total: 9 };

  // collections with cumulus_id 0-9 are filtered out
  t.is(response.meta.count, 89);
  t.is(response.results?.length, 89);
  t.deepEqual(response.results[0].stats, expectedStats0);
  t.deepEqual(response.results[88].stats, expectedStats98);
});

test.serial('CollectionSearch support search for active collections and stats with granules from a given provider', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: '200',
    active: 'true',
    includeStats: 'true',
    provider: t.context.provider.name,
    sort_by: 'version',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  // collection_cumulus_id 1
  const expectedStats0 = { queued: 3, completed: 2, failed: 3, running: 3, total: 11 };
  // collection_cumulus_id 97
  const expectedStats48 = { queued: 3, completed: 2, failed: 3, running: 2, total: 10 };

  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
  t.deepEqual(response.results[0].stats, expectedStats0);
  t.deepEqual(response.results[48].stats, expectedStats48);
});

test.serial('CollectionSearch support search for active collections and stats with granules in the granuleId list', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: '200',
    active: 'true',
    includeStats: 'true',
    granuleId__in: [t.context.granules[0].granule_id, t.context.granules[5].granule_id].join(','),
    sort_by: 'version',
  };
  const dbSearch = new CollectionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  // collection_cumulus_id 0
  const expectedStats0 = { queued: 1, completed: 0, failed: 0, running: 0, total: 1 };
  // collection_cumulus_id 5
  const expectedStats1 = { queued: 0, completed: 0, failed: 1, running: 0, total: 1 };

  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);
  t.deepEqual(response.results[0].stats, expectedStats0);
  t.deepEqual(response.results[1].stats, expectedStats1);
});
