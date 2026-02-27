'use strict';

const test = require('ava');
const knex = require('knex');
const omit = require('lodash/omit');
const cryptoRandomString = require('crypto-random-string');
const random = require('lodash/random');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  createDuckDBTables,
  setupDuckDBWithS3ForTesting,
  stageAndLoadDuckDBTableFromData,
} = require('../../dist/test-duckdb-utils');
const {
  collectionsS3TableSql,
  executionsS3TableSql,
  providersS3TableSql,
  pdrsS3TableSql,
} = require('../../dist/s3search/s3TableSchemas');
const { PdrS3Search } = require('../../dist/s3search/PdrS3Search');

const {
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
} = require('../../dist');

// generate PDR name for infix and prefix search
const generatePdrName = (num) => {
  let name = cryptoRandomString({ length: 10 });
  if (num % 30 === 0) name = `${cryptoRandomString({ length: 5 })}infix${cryptoRandomString({ length: 5 })}`;
  if (num % 25 === 0) name = `prefix${cryptoRandomString({ length: 10 })}`;
  return name;
};

// DuckDB float comparisons require a range to account for precision errors
const FLOAT_EPSILON = 1e-4;

test.before(async (t) => {
  t.context.knexBuilder = knex({ client: 'pg' });

  // Create collection
  t.context.collectionName = 'fakeCollection';
  t.context.collectionVersion = 'v1';

  const collectionName2 = 'testCollection2';
  const collectionVersion2 = 'v2';

  t.context.collectionId = constructCollectionId(
    t.context.collectionName,
    t.context.collectionVersion
  );

  t.context.collectionId2 = constructCollectionId(
    collectionName2,
    collectionVersion2
  );

  t.context.testPgCollection = fakeCollectionRecordFactory({
    cumulus_id: random(1, 100),
    name: t.context.collectionName,
    version: t.context.collectionVersion,
  });
  t.context.testPgCollection2 = fakeCollectionRecordFactory({
    cumulus_id: random(101, 200),
    name: collectionName2,
    version: collectionVersion2,
  });

  t.context.collectionCumulusId = t.context.testPgCollection.cumulus_id;
  t.context.collectionCumulusId2 = t.context.testPgCollection2.cumulus_id;

  // Create provider
  t.context.provider = fakeProviderRecordFactory({
    cumulus_id: random(1, 100),
  });

  t.context.providerCumulusId = t.context.provider.cumulus_id;

  // Create execution
  t.context.execution = fakeExecutionRecordFactory({
    cumulus_id: random(1, 100),
  });

  t.context.executionCumulusId = t.context.execution.cumulus_id;

  t.context.pdrSearchFields = {
    createdAt: 1579352700000,
    duration: 6.8,
    progress: 0.9,
    status: 'failed',
    timestamp: 1579352700000,
    updatedAt: 1579352700000,
  };

  t.context.pdrNames = range(100).map(generatePdrName);
  t.context.pdrs = range(50).map((num) => fakePdrRecordFactory({
    cumulus_id: num,
    name: t.context.pdrNames[num],
    created_at: new Date(t.context.pdrSearchFields.createdAt),
    collection_cumulus_id: (num % 2)
      ? t.context.collectionCumulusId : t.context.collectionCumulusId2,
    provider_cumulus_id: t.context.providerCumulusId,
    execution_cumulus_id: !(num % 2) ? t.context.executionCumulusId : undefined,
    status: !(num % 2) ? t.context.pdrSearchFields.status : 'completed',
    progress: num / 50,
    pan_sent: num % 2 === 0,
    pan_message: `pan${cryptoRandomString({ length: 10 })}`,
    stats: {
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0,
    },
    address: `address${cryptoRandomString({ length: 10 })}`,
    original_url: !(num % 50) ? `url${cryptoRandomString({ length: 10 })}` : undefined,
    duration: t.context.pdrSearchFields.duration + (num % 2),
    updated_at: new Date(t.context.pdrSearchFields.timestamp + (num % 2) * 1000),
  }));

  const { instance, connection } = await setupDuckDBWithS3ForTesting();
  t.context.instance = instance;
  t.context.connection = connection;

  t.context.testBucket = cryptoRandomString({ length: 10 });
  await s3().createBucket({ Bucket: t.context.testBucket });
  await createDuckDBTables(connection);

  const duckdbS3Prefix = `s3://${t.context.testBucket}/duckdb/`;

  console.log('create collections');
  const collections = [t.context.testPgCollection, t.context.testPgCollection2];
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'collections',
    collectionsS3TableSql,
    collections,
    `${duckdbS3Prefix}collections.parquet`
  );

  console.log('create providers');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'providers',
    providersS3TableSql,
    t.context.provider,
    `${duckdbS3Prefix}providers.parquet`
  );

  console.log('create executions');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'executions',
    executionsS3TableSql,
    t.context.execution,
    `${duckdbS3Prefix}executions.parquet`
  );

  console.log('create pdrs');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'pdrs',
    pdrsS3TableSql,
    t.context.pdrs,
    `${duckdbS3Prefix}pdrs.parquet`
  );
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.testBucket);
  await t.context.connection.closeSync();
});

test.serial('PdrS3Search returns 10 PDR records by default', async (t) => {
  const { connection } = t.context;
  const execution = `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${t.context.execution.arn}`;
  const dbSearch = new PdrS3Search({}, connection);
  const response = await dbSearch.query();

  t.is(response.meta.count, 50);

  const apiPdrs = response.results || {};
  t.is(apiPdrs.length, 10);
  const validatedRecords = apiPdrs.filter((pdr) => (
    [t.context.collectionId, t.context.collectionId2].includes(pdr.collectionId)
    && (pdr.provider === t.context.provider.name)
    && (!pdr.execution || pdr.execution === execution)));
  t.is(validatedRecords.length, apiPdrs.length);
});

test.serial('PdrS3Search supports page and limit params', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 25,
    page: 2,
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 10,
    page: 5,
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 0);
});

test.serial('PdrS3Search supports infix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    infix: 'infix',
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('PdrS3Search supports prefix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    prefix: 'prefix',
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);
});

test.serial('PdrS3Search supports collectionId term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    collectionId: t.context.collectionId2,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search supports provider term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    provider: t.context.provider.name,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('PdrS3Search supports execution term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    execution: `https://example.com/${t.context.execution.arn}`,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search supports term search for boolean field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    PANSent: 'true',
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search supports term search for date field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    updatedAt: `${t.context.pdrSearchFields.updatedAt}`,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search supports term search for number field', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    duration__from: `${t.context.pdrSearchFields.duration - FLOAT_EPSILON}`,
    duration__to: `${t.context.pdrSearchFields.duration + FLOAT_EPSILON}`,
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    progress__from: `${t.context.pdrSearchFields.progress - FLOAT_EPSILON}`,
    progress__to: `${t.context.pdrSearchFields.progress + FLOAT_EPSILON}`,
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('PdrS3Search supports term search for string field', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    status: t.context.pdrSearchFields.status,
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  const dbRecord = t.context.pdrs[0];
  queryStringParameters = {
    limit: 100,
    address: dbRecord.address,
    pdrName: dbRecord.name,
    originalUrl: dbRecord.original_url,
    PANmessage: dbRecord.pan_message,
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('PdrS3Search supports term search for timestamp', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    timestamp: `${t.context.pdrSearchFields.timestamp}`,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search supports range search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    duration__from: `${t.context.pdrSearchFields.duration - 1 - FLOAT_EPSILON}`,
    duration__to: `${t.context.pdrSearchFields.duration + 1 + FLOAT_EPSILON}`,
    timestamp__from: `${t.context.pdrSearchFields.timestamp}`,
    timestamp__to: `${t.context.pdrSearchFields.timestamp + 1600}`,
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 100,
    timestamp__from: t.context.pdrSearchFields.timestamp,
    timestamp__to: t.context.pdrSearchFields.timestamp + 500,
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    duration__from: `${t.context.pdrSearchFields.duration + 2}`,
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test.serial('PdrS3Search supports search for multiple fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    collectionId__in: [t.context.collectionId2, t.context.collectionId].join(','),
    provider: t.context.provider.name,
    PANSent__not: 'false',
    status: 'failed',
    timestamp__from: t.context.pdrSearchFields.timestamp,
    timestamp__to: t.context.pdrSearchFields.timestamp + 500,
    sort_key: ['collectionId', '-timestamp'],
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search non-existing fields are ignored', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('PdrS3Search returns fields specified', async (t) => {
  const { connection } = t.context;
  const fields = 'pdrName,collectionId,progress,PANSent,status';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((pdr) => t.deepEqual(Object.keys(pdr), fields.split(',')));
});

test.serial('PdrS3Search supports sorting', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    sort_by: 'timestamp',
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results[0].updatedAt < response.results[25].updatedAt);
  t.true(response.results[1].updatedAt < response.results[40].updatedAt);

  queryStringParameters = {
    limit: 100,
    sort_by: 'timestamp',
    order: 'desc',
  };
  const dbSearch2 = new PdrS3Search({ queryStringParameters }, connection);
  const response2 = await dbSearch2.query();
  t.is(response2.meta.count, 50);
  t.is(response2.results?.length, 50);
  t.true(response2.results[0].updatedAt > response2.results[25].updatedAt);
  t.true(response2.results[1].updatedAt > response2.results[40].updatedAt);

  queryStringParameters = {
    limit: 100,
    sort_key: ['-timestamp'],
  };
  const dbSearch3 = new PdrS3Search({ queryStringParameters }, connection);
  const response3 = await dbSearch3.query();
  t.is(response3.meta.count, 50);
  t.is(response3.results?.length, 50);
  t.true(response3.results[0].updatedAt > response3.results[25].updatedAt);
  t.true(response3.results[1].updatedAt > response3.results[40].updatedAt);

  queryStringParameters = {
    limit: 100,
    sort_key: ['+progress'],
  };
  const dbSearch4 = new PdrS3Search({ queryStringParameters }, connection);
  const response4 = await dbSearch4.query();
  t.is(response4.meta.count, 50);
  t.is(response4.results?.length, 50);
  t.true(Number(response4.results[0].progress) < Number(response4.results[25].progress));
  t.true(Number(response4.results[1].progress) < Number(response4.results[40].progress));

  queryStringParameters = {
    limit: 100,
    sort_key: ['-timestamp', '+progress'],
  };
  const dbSearch5 = new PdrS3Search({ queryStringParameters }, connection);
  const response5 = await dbSearch5.query();
  t.is(response5.meta.count, 50);
  t.is(response5.results?.length, 50);
  t.true(response5.results[0].updatedAt > response5.results[25].updatedAt);
  t.true(response5.results[1].updatedAt > response5.results[40].updatedAt);
  t.true(Number(response5.results[0].progress) < Number(response5.results[10].progress));
  t.true(Number(response5.results[30].progress) < Number(response5.results[40].progress));

  queryStringParameters = {
    limit: 100,
    sort_key: ['-timestamp'],
    sort_by: 'timestamp',
    order: 'asc',
  };
  const dbSearch6 = new PdrS3Search({ queryStringParameters }, connection);
  const response6 = await dbSearch6.query();
  t.is(response6.meta.count, 50);
  t.is(response6.results?.length, 50);
  t.true(response6.results[0].updatedAt < response6.results[25].updatedAt);
  t.true(response6.results[1].updatedAt < response6.results[40].updatedAt);
});

test.serial('PdrS3Search supports sorting by CollectionId', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    sort_by: 'collectionId',
    order: 'asc',
  };
  const dbSearch8 = new PdrS3Search({ queryStringParameters }, connection);
  const response8 = await dbSearch8.query();
  t.is(response8.meta.count, 50);
  t.is(response8.results?.length, 50);
  t.true(response8.results[0].collectionId < response8.results[25].collectionId);
  t.true(response8.results[1].collectionId < response8.results[40].collectionId);

  queryStringParameters = {
    limit: 100,
    sort_key: ['-collectionId'],
  };
  const dbSearch9 = new PdrS3Search({ queryStringParameters }, connection);
  const response9 = await dbSearch9.query();
  t.is(response9.meta.count, 50);
  t.is(response9.results?.length, 50);
  t.true(response9.results[0].collectionId > response9.results[25].collectionId);
  t.true(response9.results[1].collectionId > response9.results[40].collectionId);
});

test.serial('PdrS3Search supports terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    pdrName__in: [t.context.pdrNames[0], t.context.pdrNames[5]].join(','),
    PANSent__in: 'true,false',
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);

  queryStringParameters = {
    limit: 100,
    pdrName__in: [t.context.pdrNames[0], t.context.pdrNames[5]].join(','),
    PANSent__in: 'true',
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('PdrS3Search supports collectionId terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    collectionId__in: [t.context.collectionId2, constructCollectionId('fakecollectionterms', 'v1')].join(','),
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    collectionId__in: [t.context.collectionId, t.context.collectionId2].join(','),
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('PdrS3Search supports provider terms search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    provider__in: [t.context.provider.name, 'fakeproviderterms'].join(','),
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('PdrS3Search supports execution terms search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    execution__in: [`https://example.con/${t.context.execution.arn}`, 'fakepdrterms'].join(','),
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search supports search when pdr field does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    pdrName__not: t.context.pdrNames[0],
    PANSent__not: 'true',
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    pdrName__not: t.context.pdrNames[0],
    PANSent__not: 'false',
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 24);
  t.is(response.results?.length, 24);
});

test.serial('PdrS3Search supports search which collectionId does not match the given value', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    collectionId__not: t.context.collectionId2,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search supports search which provider does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    provider__not: t.context.provider.name,
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 100,
    provider__not: 'providernotexist',
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('PdrS3Search supports search which execution does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    execution__not: `https://example.com/${t.context.execution.arn}`,
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 100,
    execution__not: 'executionnotexist',
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search supports search which checks existence of PDR field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    originalUrl__exists: 'true',
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('PdrS3Search supports search which checks existence of collectionId', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    collectionId__exists: 'true',
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  queryStringParameters = {
    limit: 100,
    collectionId__exists: 'false',
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test.serial('PdrS3Search supports search which checks existence of provider', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    provider__exists: 'true',
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 100,
    provider__exists: 'false',
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test.serial('PdrS3Search supports search which checks existence of execution', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 100,
    execution__exists: 'true',
  };
  let dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    execution__exists: 'false',
  };
  dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('PdrS3Search returns the correct record', async (t) => {
  const { connection } = t.context;
  const dbRecord = t.context.pdrs[2];
  const queryStringParameters = {
    limit: 100,
    pdrName: dbRecord.name,
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 1);
  t.is(results?.length, 1);

  const expectedApiRecord = {
    pdrName: dbRecord.name,
    provider: t.context.provider.name,
    collectionId: t.context.collectionId2,
    status: dbRecord.status,
    createdAt: dbRecord.created_at.getTime(),
    progress: dbRecord.progress,
    execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${t.context.execution.arn}`,
    PANSent: dbRecord.pan_sent,
    PANmessage: dbRecord.pan_message,
    stats: { total: 0, failed: 0, completed: 0, processing: 0 },
    address: dbRecord.address,
    duration: dbRecord.duration,
    updatedAt: dbRecord.updated_at.getTime(),
  };

  t.deepEqual(
    omit(results?.[0], ['duration', 'progress']),
    omit(expectedApiRecord, ['duration', 'progress'])
  );
  t.true(
    Math.abs(results?.[0].duration - expectedApiRecord.duration) <= FLOAT_EPSILON
  );

  t.true(
    Math.abs(results?.[0].progress - expectedApiRecord.progress) <= FLOAT_EPSILON
  );
});

test.serial('PdrS3Search only returns count if countOnly is set to true', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    countOnly: 'true',
  };
  const dbSearch = new PdrS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.true(response.meta.count > 0, 'Expected response.meta.count to be greater than 0');
  t.is(response.results?.length, 0);
});
