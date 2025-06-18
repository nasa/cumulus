const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

const { constructCollectionId } = require('@cumulus/message/Collections');
const { sleep } = require('@cumulus/common');
const {
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  GranuleSearch,
  PdrPgModel,
  ProviderPgModel,
  migrationDir,
  FilePgModel,
  fakeFileRecordFactory,
  ExecutionPgModel,
  fakeExecutionRecordFactory,
  GranulesExecutionsPgModel,
} = require('../../dist');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

// generate granuleId for infix and prefix search
const generateGranuleId = (num) => {
  let granuleId = cryptoRandomString({ length: 10 });
  if (num % 30 === 0) granuleId = `${cryptoRandomString({ length: 5 })}infix${cryptoRandomString({ length: 5 })}`;
  if (num % 50 === 0) granuleId = `prefix${cryptoRandomString({ length: 10 })}`;
  return granuleId;
};

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  // Create collection
  t.context.collectionPgModel = new CollectionPgModel();
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
    name: t.context.collectionName,
    version: t.context.collectionVersion,
  });
  t.context.testPgCollection2 = fakeCollectionRecordFactory({
    name: collectionName2,
    version: collectionVersion2,
  });

  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection
  );
  const [pgCollection2] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection2
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  t.context.collectionCumulusId2 = pgCollection2.cumulus_id;

  // Create provider
  t.context.providerPgModel = new ProviderPgModel();
  t.context.provider = fakeProviderRecordFactory();

  const [pgProvider] = await t.context.providerPgModel.create(
    t.context.knex,
    t.context.provider
  );
  t.context.providerCumulusId = pgProvider.cumulus_id;

  // Create PDR
  t.context.pdrPgModel = new PdrPgModel();
  t.context.pdr = fakePdrRecordFactory({
    collection_cumulus_id: pgCollection.cumulus_id,
    provider_cumulus_id: t.context.providerCumulusId,
  });
  const [pgPdr] = await t.context.pdrPgModel.create(
    t.context.knex,
    t.context.pdr
  );
  t.context.pdrCumulusId = pgPdr.cumulus_id;

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

  t.context.granulePgModel = new GranulePgModel();
  t.context.pgGranules = await t.context.granulePgModel.insert(
    knex,
    range(100).map((num) => fakeGranuleRecordFactory({
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
        ? t.context.granuleSearchFields.lastUpdateDateTime : undefined,
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
    }))
  );

  const filePgModel = new FilePgModel();
  await filePgModel.insert(
    knex,
    t.context.pgGranules.map((granule) => fakeFileRecordFactory(
      {
        granule_cumulus_id: granule.cumulus_id,
        path: 'a.txt',
        checksum_type: 'md5',
      }
    ))
  );
  await filePgModel.insert(
    knex,
    t.context.pgGranules.map((granule) => fakeFileRecordFactory(
      {
        granule_cumulus_id: granule.cumulus_id,
        path: 'b.txt',
        checksum_type: 'sha256',
      }
    ))
  );

  const executionPgModel = new ExecutionPgModel();
  const granuleExecutionPgModel = new GranulesExecutionsPgModel();

  let executionRecords = await executionPgModel.insert(
    knex,
    t.context.pgGranules.map((_, i) => fakeExecutionRecordFactory({
      url: `earlierUrl${i}`,
    }))
  );
  await granuleExecutionPgModel.insert(
    knex,
    t.context.pgGranules.map((granule, i) => ({
      granule_cumulus_id: granule.cumulus_id,
      execution_cumulus_id: executionRecords[i].cumulus_id,
    }))
  );
  executionRecords = [];
  // it's important for later testing that these are uploaded strictly in order
  for (const i of range(100)) {
    const [executionRecord] = await executionPgModel.insert( // eslint-disable-line no-await-in-loop
      knex,
      [fakeExecutionRecordFactory({
        url: `laterUrl${i}`,
      })]
    );
    executionRecords.push(executionRecord);
    //ensure that timestamp in execution record is distinct
    await sleep(1); // eslint-disable-line no-await-in-loop
  }

  await granuleExecutionPgModel.insert(
    knex,
    t.context.pgGranules.map((granule, i) => ({
      granule_cumulus_id: granule.cumulus_id,
      execution_cumulus_id: executionRecords[i].cumulus_id,
    }))
  );
  await granuleExecutionPgModel.insert(
    knex,
    t.context.pgGranules.map((granule, i) => ({
      granule_cumulus_id: granule.cumulus_id,
      execution_cumulus_id: executionRecords[99 - i].cumulus_id,
    }))
  );
});

test('GranuleSearch returns 10 granule records by default', async (t) => {
  const { knex } = t.context;
  const dbSearch = new GranuleSearch();
  const response = await dbSearch.query(knex);

  t.is(response.meta.count, 100);

  const apiGranules = response.results || {};
  t.is(apiGranules.length, 10);
  const validatedRecords = apiGranules.filter((granule) => (
    [t.context.collectionId, t.context.collectionId2].includes(granule.collectionId)
    && (!granule.provider || granule.provider === t.context.provider.name)
    && (!granule.pdrName || granule.pdrName === t.context.pdr.name)));
  t.is(validatedRecords.length, apiGranules.length);
});

test('GranuleSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 20,
    page: 2,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 11,
    page: 10,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 10,
    page: 11,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 0);
});

test('GranuleSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    infix: 'infix',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 3);
  t.is(response.results?.length, 3);
});

test('GranuleSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    prefix: 'prefix',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);
});

test('GranuleSearch supports collectionId term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    collectionId: t.context.collectionId2,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports provider term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    provider: t.context.provider.name,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports pdrName term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    pdrName: t.context.pdr.name,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports term search for boolean field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    published: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    beginningDateTime: t.context.granuleSearchFields.beginningDateTime,
    endingDateTime: t.context.granuleSearchFields.endingDateTime,
    lastUpdateDateTime: t.context.granuleSearchFields.lastUpdateDateTime,
    updatedAt: `${t.context.granuleSearchFields.updatedAt}`,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports term search for number field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 5,
    duration: t.context.granuleSearchFields.duration,
    productVolume: t.context.granuleSearchFields.productVolume,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 200,
    timeToArchive: t.context.granuleSearchFields.timeToArchive,
    timeToPreprocess: t.context.granuleSearchFields.timeToPreprocess,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 5);
  t.is(response.results?.length, 5);
});

test('GranuleSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    status: t.context.granuleSearchFields.status,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    cmrLink: t.context.granuleSearchFields.cmrLink,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports term search for timestamp', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp: `${t.context.granuleSearchFields.timestamp}`,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports term search for nested error.Error', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    'error.Error': 'CumulusMessageAdapterExecutionError',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports range search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    beginningDateTime__from: '2020-03-16',
    duration__from: `${t.context.granuleSearchFields.duration - 1}`,
    duration__to: `${t.context.granuleSearchFields.duration + 1}`,
    timestamp__from: `${t.context.granuleSearchFields.timestamp}`,
    timestamp__to: `${t.context.granuleSearchFields.timestamp + 1600}`,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);

  queryStringParameters = {
    limit: 200,
    timestamp__from: t.context.granuleSearchFields.timestamp,
    timestamp__to: t.context.granuleSearchFields.timestamp + 500,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    duration__from: `${t.context.granuleSearchFields.duration + 2}`,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test('GranuleSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
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
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test('GranuleSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test('GranuleSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  const fields = 'granuleId,endingDateTime,collectionId,published,status';
  const queryStringParameters = {
    estimateTableRowCount: 'false',
    fields,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 10);
  response.results.forEach((granule) => t.deepEqual(Object.keys(granule), fields.split(',')));
});

test('GranuleSearch supports sorting', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_by: 'timestamp',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
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
  const dbSearch2 = new GranuleSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 100);
  t.is(response2.results?.length, 100);
  t.true(response2.results[0].updatedAt > response2.results[99].updatedAt);
  t.true(response2.results[1].updatedAt > response2.results[50].updatedAt);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['-timestamp'],
  };
  const dbSearch3 = new GranuleSearch({ queryStringParameters });
  const response3 = await dbSearch3.query(knex);
  t.is(response3.meta.count, 100);
  t.is(response3.results?.length, 100);
  t.true(response3.results[0].updatedAt > response3.results[99].updatedAt);
  t.true(response3.results[1].updatedAt > response3.results[50].updatedAt);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['+productVolume'],
  };
  const dbSearch4 = new GranuleSearch({ queryStringParameters });
  const response4 = await dbSearch4.query(knex);
  t.is(response4.meta.count, 100);
  t.is(response4.results?.length, 100);
  t.true(Number(response4.results[0].productVolume) < Number(response4.results[1].productVolume));
  t.true(Number(response4.results[98].productVolume) < Number(response4.results[99].productVolume));

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['-timestamp', '+productVolume'],
  };
  const dbSearch5 = new GranuleSearch({ queryStringParameters });
  const response5 = await dbSearch5.query(knex);
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
  const dbSearch6 = new GranuleSearch({ queryStringParameters });
  const response6 = await dbSearch6.query(knex);
  t.is(response6.meta.count, 100);
  t.is(response6.results?.length, 100);
  t.true(response6.results[0].updatedAt < response6.results[99].updatedAt);
  t.true(response6.results[1].updatedAt < response6.results[50].updatedAt);
});

test('GranuleSearch supports sorting by CollectionId', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_by: 'collectionId',
    order: 'asc',
  };
  const dbSearch8 = new GranuleSearch({ queryStringParameters });
  const response8 = await dbSearch8.query(knex);
  t.is(response8.meta.count, 100);
  t.is(response8.results?.length, 100);
  t.true(response8.results[0].collectionId < response8.results[99].collectionId);
  t.true(response8.results[0].collectionId < response8.results[50].collectionId);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['-collectionId'],
  };
  const dbSearch9 = new GranuleSearch({ queryStringParameters });
  const response9 = await dbSearch9.query(knex);
  t.is(response9.meta.count, 100);
  t.is(response9.results?.length, 100);
  t.true(response9.results[0].collectionId > response9.results[99].collectionId);
  t.true(response9.results[0].collectionId > response9.results[50].collectionId);
});

test('GranuleSearch supports sorting by Error', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    sort_by: 'error.Error',
  };
  const dbSearch7 = new GranuleSearch({ queryStringParameters });
  const response7 = await dbSearch7.query(knex);
  t.is(response7.results[0].error.Error, 'CumulusMessageAdapterExecutionError');
  t.is(response7.results[99].error, undefined);

  queryStringParameters = {
    limit: 200,
    sort_by: 'error.Error.keyword',
    order: 'asc',
  };
  const dbSearch10 = new GranuleSearch({ queryStringParameters });
  const response10 = await dbSearch10.query(knex);
  t.is(response10.results[0].error.Error, 'CumulusMessageAdapterExecutionError');
  t.is(response10.results[99].error, undefined);
});

test('GranuleSearch supports terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    granuleId__in: [t.context.granuleIds[0], t.context.granuleIds[5]].join(','),
    published__in: 'true,false',
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);

  queryStringParameters = {
    limit: 200,
    granuleId__in: [t.context.granuleIds[0], t.context.granuleIds[5]].join(','),
    published__in: 'true',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports collectionId terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId2, constructCollectionId('fakecollectionterms', 'v1')].join(','),
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId, t.context.collectionId2].join(','),
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test('GranuleSearch supports provider terms search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    provider__in: [t.context.provider.name, 'fakeproviderterms'].join(','),
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports pdrName terms search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    pdrName__in: [t.context.pdr.name, 'fakepdrterms'].join(','),
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports error.Error terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    'error.Error__in': [t.context.granuleSearchFields['error.Error'], 'unknownerror'].join(','),
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    'error.Error__in': 'unknownerror',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test('GranuleSearch supports search when granule field does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    granuleId__not: t.context.granuleIds[0],
    published__not: 'true',
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);

  queryStringParameters = {
    limit: 200,
    granuleId__not: t.context.granuleIds[0],
    published__not: 'false',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports search which collectionId does not match the given value', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    collectionId__not: t.context.collectionId2,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports search which provider does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    provider__not: t.context.provider.name,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 200,
    provider__not: 'providernotexist',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports search which pdrName does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    pdrName__not: t.context.pdr.name,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 200,
    pdrName__not: 'pdrnotexist',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports search which error.Error does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    'error.Error__not': t.context.granuleSearchFields['error.Error'],
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 200,
    'error.Error__not': 'unknownerror',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports search which checks existence of granule field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    cmrLink__exists: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports search which checks existence of collectionId', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    collectionId__exists: 'true',
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  queryStringParameters = {
    limit: 200,
    collectionId__exists: 'false',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test('GranuleSearch supports search which checks existence of provider', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    provider__exists: 'true',
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    provider__exists: 'false',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports search which checks existence of pdrName', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    pdrName__exists: 'true',
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    pdrName__exists: 'false',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports search which checks existence of error', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    error__exists: 'true',
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    error__exists: 'false',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch estimates the rowcount of the table by default', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.true(response.meta.count > 0, 'Expected response.meta.count to be greater than 0');
  t.is(response.results?.length, 50);
});

test('GranuleSearch only returns count if countOnly is set to true', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    countOnly: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.true(response.meta.count > 0, 'Expected response.meta.count to be greater than 0');
  t.is(response.results?.length, 0);
});

test('GranuleSearch with includeFullRecord true retrieves associated file objects for granules', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.results?.length, 100);
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.files?.length, 2);
    t.true('bucket' in granuleRecord.files[0]);
    t.true('key' in granuleRecord.files[0]);
    t.true('bucket' in granuleRecord.files[1]);
    t.true('key' in granuleRecord.files[1]);
  });
});
test('GranuleSearch with includeFullRecord true retrieves associated file translated to api key format', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
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

test('GranuleSearch with includeFullRecord true retrieves one associated Url object for granules', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.results?.length, 100);
  response.results.forEach((granuleRecord) => {
    t.true('execution' in granuleRecord);
  });
});

test('GranuleSearch with includeFullRecord true retrieves latest associated Url object for granules', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
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

test('GranuleSearch with includeFullRecord true retrieves granules, files and executions, with limit specifying number of granules', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 4,
    includeFullRecord: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.results?.length, 4);
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.files?.length, 2);
    t.true('bucket' in granuleRecord.files[0]);
    t.true('key' in granuleRecord.files[0]);
    t.true('bucket' in granuleRecord.files[1]);
    t.true('key' in granuleRecord.files[1]);
  });
});

test('GranuleSearch with archived: true pulls only archive granules', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    archived: true
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.archived, true);
  });
})

test('GranuleSearch with archived: false pulls only non-archive granules', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    archived: false
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  response.results.forEach((granuleRecord) => {
    t.is(granuleRecord.archived, false);
  });
})