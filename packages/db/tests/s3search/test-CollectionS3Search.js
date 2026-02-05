const test = require('ava');
const knex = require('knex');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');
const { DuckDBInstance } = require('@duckdb/node-api');
const { CollectionS3Search } = require('../../dist/s3search/CollectionS3Search');
const { collectionsS3TableSql } = require('../../dist/s3search/s3TableSchemas');

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

  const sanitizedCollections = collections.map((c) => ({
    ...c,
    // Ensure dates are in ISO format
    created_at: c.created_at.toISOString(),
    updated_at: c.updated_at.toISOString(),
  }));

  // Create provider
  t.context.provider = fakeProviderRecordFactory();
  const statuses = ['queued', 'failed', 'completed', 'running'];
  t.context.granuleSearchTmestamp = 1688888800000;
  t.context.granules = range(100).map((num) => (
    fakeGranuleRecordFactory({
      // collection with cumulus_id 0-9 each has 11 granules,
      // collection 10-98 has 10 granules, and collection 99 has 0 granule
      collection_cumulus_id: num % 99,
      cumulus_id: 100 + num,
      // when collection_cumulus_id is odd number(1,3,5...97), its granules have provider
      provider_cumulus_id: (num % 99 % 2) ? t.context.providerCumulusId : undefined,
      status: statuses[num % 4],
      // granule with collection_cumulus_id n has timestamp granuleSearchTmestamp + n,
      // except granule 98 (with collection 98 ) which has timestamp granuleSearchTmestamp - 1
      updated_at: num === 98
        ? new Date(t.context.granuleSearchTmestamp - 1)
        : new Date(t.context.granuleSearchTmestamp + (num % 99)),
    })
  ));

  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  await conn.run(`
    INSTALL httpfs;
    LOAD httpfs;
    SET s3_region='us-east-1';
    SET s3_access_key_id='test';
    SET s3_secret_access_key='test';
    SET s3_endpoint='localhost:4566';
    SET s3_use_ssl=false;
    SET s3_url_style='path';
  `);

  await conn.run(collectionsS3TableSql('collections_tmp'));

  await s3().createBucket({ Bucket: 'test-bucket' });
  const insertQuery = t.context.knexBuilder('collections_tmp').insert(sanitizedCollections).toSQL().toNative();
  console.log(insertQuery);

  await conn.run(insertQuery.sql, insertQuery.bindings);

  await conn.run(`
    COPY collections_tmp
    TO 's3://test-bucket/duckdb/collections/collections.parquet'
    (FORMAT PARQUET);
  `);

  await conn.run(collectionsS3TableSql('collections'));
  await conn.run(`
    COPY collections
    FROM 's3://test-bucket/duckdb/collections/collections.parquet'
    (FORMAT PARQUET);
  `);

  t.context.conn = conn;
});

test('CollectionS3Search returns 10 collections by default', async (t) => {
  const { conn } = t.context;
  const dbSearch = new CollectionS3Search({}, conn);
  const results = await dbSearch.query();
  console.log(results);
  t.is(results.meta.count, 100);
  t.is(results.results.length, 10);
});
