'use strict';

const test = require('ava');
const knex = require('knex');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
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
const { GranuleS3Search } = require('../../dist/s3search/GranuleS3Search');
const {
  collectionsS3TableSql,
  executionsS3TableSql,
  filesS3TableSql,
  granulesS3TableSql,
  granulesExecutionsS3TableSql,
  providersS3TableSql,
  pdrsS3TableSql,
} = require('../../dist/s3search/s3TableSchemas');
const {
  translatePostgresGranuleToApiGranuleWithoutDbQuery,
} = require('../../dist/translate/granules');

const {
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  fakeFileRecordFactory,
  fakeExecutionRecordFactory,
} = require('../../dist');

// generate granuleId for infix and prefix search
const generateGranuleId = (num) => {
  let granuleId = cryptoRandomString({ length: 10 });
  if (num % 30 === 0) granuleId = `${cryptoRandomString({ length: 5 })}infix${cryptoRandomString({ length: 5 })}`;
  if (num % 50 === 0) granuleId = `prefix${cryptoRandomString({ length: 10 })}`;
  return granuleId;
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

  const collections = [
    t.context.testPgCollection,
    t.context.testPgCollection2];

  t.context.collectionCumulusId = t.context.testPgCollection.cumulus_id;
  t.context.collectionCumulusId2 = t.context.testPgCollection2.cumulus_id;

  // Create provider
  t.context.provider = fakeProviderRecordFactory({
    cumulus_id: random(1, 100),
  });
  t.context.providerCumulusId = t.context.provider.cumulus_id;

  // Create PDR
  t.context.pdr = fakePdrRecordFactory({
    cumulus_id: random(1, 100),
    collection_cumulus_id: t.context.testPgCollection.cumulus_id,
    provider_cumulus_id: t.context.providerCumulusId,
  });
  t.context.pdrCumulusId = t.context.pdr.cumulus_id;

  // Create Granule
  t.context.granuleSearchFields = {
    beginningDateTime: '2020-03-16T19:50:24.757Z',
    cmrLink: 'https://fakeLink',
    duration: 6.8,
    endingDateTime: '2020-03-17T10:00:00.000Z',
    'error.Error': 'CumulusMessageAdapterExecutionError',
    lastUpdateDateTime: '2020-03-18T10:00:00.000Z',
    processingEndDateTime: '2020-03-16T10:00:00.000Z',
    productVolume: '6000',
    timeToArchive: '700.29',
    timeToPreprocess: '800.18',
    status: 'failed',
    timestamp: 1579352700000,
    updatedAt: 1579352700000,
  };

  t.context.granuleIds = range(100).map(generateGranuleId);

  const error = {
    Cause: 'cause string',
    Error: 'CumulusMessageAdapterExecutionError',
  };

  t.context.granules = range(100)
    .map((num) => fakeGranuleRecordFactory({
      cumulus_id: num,
      granule_id: t.context.granuleIds[num],
      collection_cumulus_id: (num % 2)
        ? t.context.collectionCumulusId : t.context.collectionCumulusId2,
      pdr_cumulus_id: !(num % 2) ? t.context.pdrCumulusId : undefined,
      provider_cumulus_id: !(num % 2) ? t.context.providerCumulusId : undefined,
      beginning_date_time: new Date(t.context.granuleSearchFields.beginningDateTime),
      cmr_link: !(num % 100) ? t.context.granuleSearchFields.cmrLink : undefined,
      duration: t.context.granuleSearchFields.duration + (num % 2),
      ending_date_time: !(num % 2)
        ? new Date(t.context.granuleSearchFields.endingDateTime) : new Date(),
      error: !(num % 2) ? JSON.stringify(error) : undefined,
      last_update_date_time: !(num % 2)
        ? new Date(t.context.granuleSearchFields.lastUpdateDateTime) : undefined,
      published: !!(num % 2),
      product_volume: Math.round(Number(t.context.granuleSearchFields.productVolume)
        * (1 / (num + 1))).toString(),
      time_to_archive: !(num % 10)
        ? Number(t.context.granuleSearchFields.timeToArchive) : undefined,
      time_to_process: !(num % 20)
        ? Number(t.context.granuleSearchFields.timeToPreprocess) : undefined,
      status: !(num % 2) ? t.context.granuleSearchFields.status : 'completed',
      updated_at: new Date(t.context.granuleSearchFields.timestamp + (num % 2) * 1000),
      archived: Boolean(num % 2),
    }));

  t.context.files = t.context.granules
    .flatMap((granule, i) => [
      fakeFileRecordFactory(
        {
          cumulus_id: i,
          granule_cumulus_id: granule.cumulus_id,
          path: 'a.txt',
          checksum_type: 'md5',
        }
      ),
      fakeFileRecordFactory(
        {
          cumulus_id: i + 100,
          granule_cumulus_id: granule.cumulus_id,
          path: 'b.txt',
          checksum_type: 'sha256',
        }
      ),
    ]);

  const earlierBaseTime = Date.now();
  const earlierExecutionRecords = t.context.granules
    .map((_, i) => fakeExecutionRecordFactory({
      cumulus_id: i + 1,
      url: `earlierUrl${i}`,
      created_at: new Date(earlierBaseTime + i),
      updated_at: new Date(earlierBaseTime + i),
      timestamp: new Date(earlierBaseTime + i),
    }));

  const earlierGranuleExecutions = t.context.granules
    .map((granule, i) => ({
      granule_cumulus_id: granule.cumulus_id,
      execution_cumulus_id: earlierExecutionRecords[i].cumulus_id,
    }));

  // it's important for later testing that these are uploaded strictly in order
  const laterBaseTime = Date.now() + 100;
  const laterExecutionRecords = range(100).map((i) => (
    fakeExecutionRecordFactory({
      cumulus_id: i + 200,
      url: `laterUrl${i}`,
      created_at: new Date(laterBaseTime + i),
      updated_at: new Date(laterBaseTime + i),
      timestamp: new Date(laterBaseTime + i),
    })
  ));

  const laterGranuleExecutions = t.context.granules
    .flatMap((granule, i) => ([
      {
        granule_cumulus_id: granule.cumulus_id,
        execution_cumulus_id: laterExecutionRecords[i].cumulus_id,
      },
      {
        granule_cumulus_id: granule.cumulus_id,
        execution_cumulus_id: laterExecutionRecords[99 - i].cumulus_id,
      },
    ]));

  const executions = [
    ...earlierExecutionRecords,
    ...laterExecutionRecords,
  ];

  const granuleExecutions = [
    ...earlierGranuleExecutions,
    ...laterGranuleExecutions,
  ];

  const { instance, connection } = await setupDuckDBWithS3ForTesting();
  t.context.instance = instance;
  t.context.connection = connection;

  t.context.testBucket = cryptoRandomString({ length: 10 });
  await s3().createBucket({ Bucket: t.context.testBucket });
  await createDuckDBTables(connection);

  const duckdbS3Prefix = `s3://${t.context.testBucket}/duckdb/`;

  console.log('create collections');
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

  console.log('create granules');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'granules',
    granulesS3TableSql,
    t.context.granules,
    `${duckdbS3Prefix}granules.parquet`
  );

  console.log('create files');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'files',
    filesS3TableSql,
    t.context.files,
    `${duckdbS3Prefix}files.parquet`
  );

  console.log('create executions');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'executions',
    executionsS3TableSql,
    executions,
    `${duckdbS3Prefix}executions.parquet`
  );

  console.log('create granules_executions');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'granules_executions',
    granulesExecutionsS3TableSql,
    granuleExecutions,
    `${duckdbS3Prefix}granules_executions.parquet`
  );

  console.log('create pdrs');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'pdrs',
    pdrsS3TableSql,
    t.context.pdr,
    `${duckdbS3Prefix}pdrs.parquet`
  );
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.testBucket);
  await t.context.connection.closeSync();
});

test.serial('GranuleS3Search returns 10 granule records by default', async (t) => {
  const { connection } = t.context;
  const dbSearch = new GranuleS3Search({}, connection);
  const response = await dbSearch.query();

  t.is(response.meta.count, 100);

  const apiGranules = response.results || {};
  t.is(apiGranules.length, 10);
  const validatedRecords = apiGranules.filter((granule) => (
    [t.context.collectionId, t.context.collectionId2].includes(granule.collectionId)
    && (!granule.provider || granule.provider === t.context.provider.name)
    && (!granule.pdrName || granule.pdrName === t.context.pdr.name)));
  t.is(validatedRecords.length, apiGranules.length);
});

test.serial('GranuleS3Search supports page and limit params', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 20,
    page: 2,
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 11,
    page: 10,
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 10,
    page: 11,
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 0);
});

test.serial('GranuleS3Search supports infix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    infix: 'infix',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 3);
  t.is(response.results?.length, 3);
});

test.serial('GranuleS3Search supports prefix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    prefix: 'prefix',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);
});

test.serial('GranuleS3Search supports collectionId term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    collectionId: t.context.collectionId2,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports provider term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    provider: t.context.provider.name,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports pdrName term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    pdrName: t.context.pdr.name,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports term search for boolean field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    published: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports term search for date field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    beginningDateTime: t.context.granuleSearchFields.beginningDateTime,
    endingDateTime: t.context.granuleSearchFields.endingDateTime,
    lastUpdateDateTime: t.context.granuleSearchFields.lastUpdateDateTime,
    updatedAt: `${t.context.granuleSearchFields.updatedAt}`,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports term search for number field', async (t) => {
  const { connection } = t.context;

  let queryStringParameters = {
    limit: 5,
    duration__from: `${t.context.granuleSearchFields.duration - FLOAT_EPSILON}`,
    duration__to: `${t.context.granuleSearchFields.duration + FLOAT_EPSILON}`,
    productVolume: t.context.granuleSearchFields.productVolume,
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 200,
    timeToArchive__from: `${t.context.granuleSearchFields.timeToArchive - FLOAT_EPSILON}`,
    timeToArchive__to: `${t.context.granuleSearchFields.timeToArchive + FLOAT_EPSILON}`,
    timeToPreprocess__from: `${t.context.granuleSearchFields.timeToPreprocess - FLOAT_EPSILON}`,
    timeToPreprocess__to: `${t.context.granuleSearchFields.timeToPreprocess + FLOAT_EPSILON}`,
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 5);
  t.is(response.results?.length, 5);
});

test.serial('GranuleS3Search supports term search for string field', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    status: t.context.granuleSearchFields.status,
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    cmrLink: t.context.granuleSearchFields.cmrLink,
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('GranuleS3Search supports term search for timestamp', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp: `${t.context.granuleSearchFields.timestamp}`,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports term search for nested error.Error', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    'error.Error': 'CumulusMessageAdapterExecutionError',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports range search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    beginningDateTime__from: '2020-03-16',
    duration__from: `${t.context.granuleSearchFields.duration - 1 - FLOAT_EPSILON}`,
    duration__to: `${t.context.granuleSearchFields.duration + 1 + FLOAT_EPSILON}`,
    timestamp__from: `${t.context.granuleSearchFields.timestamp}`,
    timestamp__to: `${t.context.granuleSearchFields.timestamp + 1600}`,
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);

  queryStringParameters = {
    limit: 200,
    timestamp__from: t.context.granuleSearchFields.timestamp,
    timestamp__to: t.context.granuleSearchFields.timestamp + 500,
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    duration__from: `${t.context.granuleSearchFields.duration + 2}`,
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test.serial('GranuleS3Search supports search for multiple fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId2, t.context.collectionId].join(','),
    cmrLink__exists: 'false',
    'error.Error': t.context.granuleSearchFields['error.Error'],
    provider: t.context.provider.name,
    published__not: 'true',
    status: 'failed',
    timestamp__from: t.context.granuleSearchFields.timestamp,
    timestamp__to: t.context.granuleSearchFields.timestamp + 500,
    sort_key: ['collectionId', '-timestamp'],
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test.serial('GranuleS3Search non-existing fields are ignored', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test.serial('GranuleS3Search returns fields specified', async (t) => {
  const { connection } = t.context;
  const fields = 'granuleId,endingDateTime,collectionId,published,status';
  const queryStringParameters = {
    estimateTableRowCount: 'false',
    fields,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 10);
  response.results.forEach((granule) => t.deepEqual(Object.keys(granule), fields.split(',')));
});

test.serial('GranuleS3Search supports sorting', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_by: 'timestamp',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.true(response.results[0].updatedAt < response.results[99].updatedAt);
  t.true(response.results[1].updatedAt < response.results[50].updatedAt);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_by: 'timestamp',
    order: 'desc',
  };
  const dbSearch2 = new GranuleS3Search({ queryStringParameters }, connection);
  const response2 = await dbSearch2.query();
  t.is(response2.meta.count, 100);
  t.is(response2.results?.length, 100);
  t.true(response2.results[0].updatedAt > response2.results[99].updatedAt);
  t.true(response2.results[1].updatedAt > response2.results[50].updatedAt);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['-timestamp'],
  };
  const dbSearch3 = new GranuleS3Search({ queryStringParameters }, connection);
  const response3 = await dbSearch3.query();
  t.is(response3.meta.count, 100);
  t.is(response3.results?.length, 100);
  t.true(response3.results[0].updatedAt > response3.results[99].updatedAt);
  t.true(response3.results[1].updatedAt > response3.results[50].updatedAt);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['+productVolume'],
  };
  const dbSearch4 = new GranuleS3Search({ queryStringParameters }, connection);
  const response4 = await dbSearch4.query();
  t.is(response4.meta.count, 100);
  t.is(response4.results?.length, 100);
  t.true(Number(response4.results[0].productVolume) < Number(response4.results[1].productVolume));
  t.true(Number(response4.results[98].productVolume) < Number(response4.results[99].productVolume));

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['-timestamp', '+productVolume'],
  };
  const dbSearch5 = new GranuleS3Search({ queryStringParameters }, connection);
  const response5 = await dbSearch5.query();
  t.is(response5.meta.count, 100);
  t.is(response5.results?.length, 100);
  t.true(response5.results[0].updatedAt > response5.results[99].updatedAt);
  t.true(response5.results[1].updatedAt > response5.results[50].updatedAt);
  t.true(Number(response5.results[1].productVolume) < Number(response5.results[99].productVolume));
  t.true(Number(response5.results[0].productVolume) < Number(response5.results[10].productVolume));

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['-timestamp'],
    sort_by: 'timestamp',
    order: 'asc',
  };
  const dbSearch6 = new GranuleS3Search({ queryStringParameters }, connection);
  const response6 = await dbSearch6.query();
  t.is(response6.meta.count, 100);
  t.is(response6.results?.length, 100);
  t.true(response6.results[0].updatedAt < response6.results[99].updatedAt);
  t.true(response6.results[1].updatedAt < response6.results[50].updatedAt);
});

test.serial('GranuleS3Search supports sorting by CollectionId', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_by: 'collectionId',
    order: 'asc',
  };
  const dbSearch8 = new GranuleS3Search({ queryStringParameters }, connection);
  const response8 = await dbSearch8.query();
  t.is(response8.meta.count, 100);
  t.is(response8.results?.length, 100);
  t.true(response8.results[0].collectionId < response8.results[99].collectionId);
  t.true(response8.results[0].collectionId < response8.results[50].collectionId);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['-collectionId'],
  };
  const dbSearch9 = new GranuleS3Search({ queryStringParameters }, connection);
  const response9 = await dbSearch9.query();
  t.is(response9.meta.count, 100);
  t.is(response9.results?.length, 100);
  t.true(response9.results[0].collectionId > response9.results[99].collectionId);
  t.true(response9.results[0].collectionId > response9.results[50].collectionId);
});

test.serial('GranuleS3Search supports sorting by Error', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    sort_by: 'error.Error',
  };
  const dbSearch7 = new GranuleS3Search({ queryStringParameters }, connection);
  const response7 = await dbSearch7.query();
  t.is(response7.results[0].error.Error, 'CumulusMessageAdapterExecutionError');
  t.is(response7.results[99].error, undefined);

  queryStringParameters = {
    limit: 200,
    sort_by: 'error.Error.keyword',
    order: 'asc',
  };
  const dbSearch10 = new GranuleS3Search({ queryStringParameters }, connection);
  const response10 = await dbSearch10.query();
  t.is(response10.results[0].error.Error, 'CumulusMessageAdapterExecutionError');
  t.is(response10.results[99].error, undefined);
});

test.serial('GranuleS3Search supports terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    granuleId__in: [t.context.granuleIds[0], t.context.granuleIds[5]].join(','),
    published__in: 'true,false',
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);

  queryStringParameters = {
    limit: 200,
    granuleId__in: [t.context.granuleIds[0], t.context.granuleIds[5]].join(','),
    published__in: 'true',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('GranuleS3Search supports collectionId terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId2, constructCollectionId('fakecollectionterms', 'v1')].join(','),
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId, t.context.collectionId2].join(','),
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test.serial('GranuleS3Search supports provider terms search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    provider__in: [t.context.provider.name, 'fakeproviderterms'].join(','),
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports pdrName terms search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    pdrName__in: [t.context.pdr.name, 'fakepdrterms'].join(','),
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports error.Error terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    'error.Error__in': [t.context.granuleSearchFields['error.Error'], 'unknownerror'].join(','),
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    'error.Error__in': 'unknownerror',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test.serial('GranuleS3Search supports search when granule field does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    granuleId__not: t.context.granuleIds[0],
    published__not: 'true',
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);

  queryStringParameters = {
    limit: 200,
    granuleId__not: t.context.granuleIds[0],
    published__not: 'false',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports search which collectionId does not match the given value', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    collectionId__not: t.context.collectionId2,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports search which provider does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    provider__not: t.context.provider.name,
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 200,
    provider__not: 'providernotexist',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports search which pdrName does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    pdrName__not: t.context.pdr.name,
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 200,
    pdrName__not: 'pdrnotexist',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports search which error.Error does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    'error.Error__not': t.context.granuleSearchFields['error.Error'],
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 200,
    'error.Error__not': 'unknownerror',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports search which checks existence of granule field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    cmrLink__exists: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('GranuleS3Search supports search which checks existence of collectionId', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    collectionId__exists: 'true',
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  queryStringParameters = {
    limit: 200,
    collectionId__exists: 'false',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test.serial('GranuleS3Search supports search which checks existence of provider', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    provider__exists: 'true',
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    provider__exists: 'false',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports search which checks existence of pdrName', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    pdrName__exists: 'true',
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    pdrName__exists: 'false',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search supports search which checks existence of error', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    error__exists: 'true',
  };
  let dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    error__exists: 'false',
  };
  dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search estimates the rowcount of the table by default', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.true(response.meta.count > 0, 'Expected response.meta.count to be greater than 0');
  t.is(response.results?.length, 50);
});

test.serial('GranuleS3Search only returns count if countOnly is set to true', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    countOnly: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.true(response.meta.count > 0, 'Expected response.meta.count to be greater than 0');
  t.is(response.results?.length, 0);
});

test.serial('GranuleS3Search with includeFullRecord true retrieves associated file objects for granules', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.results?.length, 100);
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.files?.length, 2);
    t.true('bucket' in granuleRecord.files[0]);
    t.true('key' in granuleRecord.files[0]);
    t.true('bucket' in granuleRecord.files[1]);
    t.true('key' in granuleRecord.files[1]);
  });
});
test.serial('GranuleS3Search with includeFullRecord true retrieves associated file translated to api key format', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.results?.length, 100);
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.files?.length, 2);
    t.true('bucket' in granuleRecord.files[0]);
    t.true('key' in granuleRecord.files[0]);
    t.true('checksumType' in granuleRecord.files[0]);
    t.true('bucket' in granuleRecord.files[1]);
    t.true('key' in granuleRecord.files[1]);
    t.true('checksumType' in granuleRecord.files[1]);
  });
});

test.serial('GranuleS3Search with includeFullRecord true retrieves one associated Url object for granules', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.results?.length, 100);
  response.results.forEach((granuleRecord) => {
    t.true('execution' in granuleRecord);
  });
});

test.serial('GranuleS3Search with includeFullRecord true retrieves latest associated Url object for granules', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.results?.length, 100);
  response.results.sort((a, b) => a.cumulus_id - b.cumulus_id);
  // these executions are loaded from lowest to highest number
  // but each granule is associated with multiple executions:
  //   earlierUrl${i}, laterUrl${i}, and laterUrl${99-i}
  // hence `laterUrl${max(i, 99-i)}` is the most recently updated execution
  response.results.forEach((granuleRecord, i) => {
    t.is(granuleRecord.execution, `laterUrl${Math.max(i, 99 - i)}`);
  });
});

test.serial('GranuleS3Search with includeFullRecord true retrieves granules, files and executions, with limit specifying number of granules', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 4,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.results?.length, 4);
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.files?.length, 2);
    t.true('bucket' in granuleRecord.files[0]);
    t.true('key' in granuleRecord.files[0]);
    t.true('bucket' in granuleRecord.files[1]);
    t.true('key' in granuleRecord.files[1]);
  });
});

test.serial('GranuleS3Search with archived: true pulls only archive granules', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    archived: true,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.archived, true);
  });
});

test.serial('GranuleS3Search with archived: false pulls only non-archive granules', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    archived: false,
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.archived, false);
  });
});

test.serial('GranuleS3Search returns the correct record', async (t) => {
  const { connection } = t.context;
  const dbRecord = t.context.granules[2];
  const queryStringParameters = {
    limit: 200,
    granuleId: dbRecord.granule_id,
    duration__from: `${t.context.granuleSearchFields.duration - FLOAT_EPSILON}`,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 1);
  t.is(results?.length, 1);

  const expectedApiRecord = translatePostgresGranuleToApiGranuleWithoutDbQuery({
    granulePgRecord: dbRecord,
    collectionPgRecord: t.context.testPgCollection2,
    executionUrls: [{ url: 'laterUrl97' }],
    files: t.context.files.filter((file) => file.granule_cumulus_id === dbRecord.cumulus_id),
    pdr: t.context.pdr,
    providerPgRecord: t.context.provider,
  });
  t.deepEqual(omit(results?.[0], ['createdAt', 'duration']), omit(expectedApiRecord, ['createdAt', 'duration']));
  t.truthy(results?.[0]?.createdAt);
});
