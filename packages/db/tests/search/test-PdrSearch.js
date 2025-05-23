const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  ExecutionPgModel,
  PdrSearch,
  PdrPgModel,
  ProviderPgModel,
  migrationDir,
} = require('../../dist');

const testDbName = `pdr_${cryptoRandomString({ length: 10 })}`;

// generate PDR name for infix and prefix search
const generatePdrName = (num) => {
  let name = cryptoRandomString({ length: 10 });
  if (num % 30 === 0) name = `${cryptoRandomString({ length: 5 })}infix${cryptoRandomString({ length: 5 })}`;
  if (num % 25 === 0) name = `prefix${cryptoRandomString({ length: 10 })}`;
  return name;
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

  // Create execution
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.execution = fakeExecutionRecordFactory();

  const [pgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    t.context.execution
  );
  t.context.executionCumulusId = pgExecution.cumulus_id;

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

  t.context.pdrPgModel = new PdrPgModel();
  t.context.pgPdrs = await t.context.pdrPgModel.insert(
    knex,
    t.context.pdrs
  );
});

test('PdrSearch returns 10 PDR records by default', async (t) => {
  const { knex } = t.context;
  const execution = `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${t.context.execution.arn}`;
  const dbSearch = new PdrSearch();
  const response = await dbSearch.query(knex);

  t.is(response.meta.count, 50);

  const apiPdrs = response.results || {};
  t.is(apiPdrs.length, 10);
  const validatedRecords = apiPdrs.filter((pdr) => (
    [t.context.collectionId, t.context.collectionId2].includes(pdr.collectionId)
    && (pdr.provider === t.context.provider.name)
    && (!pdr.execution || pdr.execution === execution)));
  t.is(validatedRecords.length, apiPdrs.length);
});

test('PdrSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 25,
    page: 2,
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 10,
    page: 5,
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 0);
});

test('PdrSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    infix: 'infix',
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('PdrSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    prefix: 'prefix',
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);
});

test('PdrSearch supports collectionId term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    collectionId: t.context.collectionId2,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch supports provider term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    provider: t.context.provider.name,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('PdrSearch supports execution term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    execution: `https://example.com/${t.context.execution.arn}`,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch supports term search for boolean field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    PANSent: 'true',
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    updatedAt: `${t.context.pdrSearchFields.updatedAt}`,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch supports term search for number field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    duration: t.context.pdrSearchFields.duration,
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    progress: t.context.pdrSearchFields.progress,
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('PdrSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    status: t.context.pdrSearchFields.status,
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
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
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('PdrSearch supports term search for timestamp', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    timestamp: `${t.context.pdrSearchFields.timestamp}`,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch supports range search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    duration__from: `${t.context.pdrSearchFields.duration - 1}`,
    duration__to: `${t.context.pdrSearchFields.duration + 1}`,
    timestamp__from: `${t.context.pdrSearchFields.timestamp}`,
    timestamp__to: `${t.context.pdrSearchFields.timestamp + 1600}`,
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 100,
    timestamp__from: t.context.pdrSearchFields.timestamp,
    timestamp__to: t.context.pdrSearchFields.timestamp + 500,
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    duration__from: `${t.context.pdrSearchFields.duration + 2}`,
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test('PdrSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
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
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('PdrSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  const fields = 'pdrName,collectionId,progress,PANSent,status';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((pdr) => t.deepEqual(Object.keys(pdr), fields.split(',')));
});

test('PdrSearch supports sorting', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    sort_by: 'timestamp',
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results[0].updatedAt < response.results[25].updatedAt);
  t.true(response.results[1].updatedAt < response.results[40].updatedAt);

  queryStringParameters = {
    limit: 100,
    sort_by: 'timestamp',
    order: 'desc',
  };
  const dbSearch2 = new PdrSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 50);
  t.is(response2.results?.length, 50);
  t.true(response2.results[0].updatedAt > response2.results[25].updatedAt);
  t.true(response2.results[1].updatedAt > response2.results[40].updatedAt);

  queryStringParameters = {
    limit: 100,
    sort_key: ['-timestamp'],
  };
  const dbSearch3 = new PdrSearch({ queryStringParameters });
  const response3 = await dbSearch3.query(knex);
  t.is(response3.meta.count, 50);
  t.is(response3.results?.length, 50);
  t.true(response3.results[0].updatedAt > response3.results[25].updatedAt);
  t.true(response3.results[1].updatedAt > response3.results[40].updatedAt);

  queryStringParameters = {
    limit: 100,
    sort_key: ['+progress'],
  };
  const dbSearch4 = new PdrSearch({ queryStringParameters });
  const response4 = await dbSearch4.query(knex);
  t.is(response4.meta.count, 50);
  t.is(response4.results?.length, 50);
  t.true(Number(response4.results[0].progress) < Number(response4.results[25].progress));
  t.true(Number(response4.results[1].progress) < Number(response4.results[40].progress));

  queryStringParameters = {
    limit: 100,
    sort_key: ['-timestamp', '+progress'],
  };
  const dbSearch5 = new PdrSearch({ queryStringParameters });
  const response5 = await dbSearch5.query(knex);
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
  const dbSearch6 = new PdrSearch({ queryStringParameters });
  const response6 = await dbSearch6.query(knex);
  t.is(response6.meta.count, 50);
  t.is(response6.results?.length, 50);
  t.true(response6.results[0].updatedAt < response6.results[25].updatedAt);
  t.true(response6.results[1].updatedAt < response6.results[40].updatedAt);
});

test('PdrSearch supports sorting by CollectionId', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    sort_by: 'collectionId',
    order: 'asc',
  };
  const dbSearch8 = new PdrSearch({ queryStringParameters });
  const response8 = await dbSearch8.query(knex);
  t.is(response8.meta.count, 50);
  t.is(response8.results?.length, 50);
  t.true(response8.results[0].collectionId < response8.results[25].collectionId);
  t.true(response8.results[1].collectionId < response8.results[40].collectionId);

  queryStringParameters = {
    limit: 100,
    sort_key: ['-collectionId'],
  };
  const dbSearch9 = new PdrSearch({ queryStringParameters });
  const response9 = await dbSearch9.query(knex);
  t.is(response9.meta.count, 50);
  t.is(response9.results?.length, 50);
  t.true(response9.results[0].collectionId > response9.results[25].collectionId);
  t.true(response9.results[1].collectionId > response9.results[40].collectionId);
});

test('PdrSearch supports terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    pdrName__in: [t.context.pdrNames[0], t.context.pdrNames[5]].join(','),
    PANSent__in: 'true,false',
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);

  queryStringParameters = {
    limit: 100,
    pdrName__in: [t.context.pdrNames[0], t.context.pdrNames[5]].join(','),
    PANSent__in: 'true',
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('PdrSearch supports collectionId terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    collectionId__in: [t.context.collectionId2, constructCollectionId('fakecollectionterms', 'v1')].join(','),
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    collectionId__in: [t.context.collectionId, t.context.collectionId2].join(','),
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('PdrSearch supports provider terms search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    provider__in: [t.context.provider.name, 'fakeproviderterms'].join(','),
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('PdrSearch supports execution terms search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    execution__in: [`https://example.con/${t.context.execution.arn}`, 'fakepdrterms'].join(','),
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch supports search when pdr field does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    pdrName__not: t.context.pdrNames[0],
    PANSent__not: 'true',
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    pdrName__not: t.context.pdrNames[0],
    PANSent__not: 'false',
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 24);
  t.is(response.results?.length, 24);
});

test('PdrSearch supports search which collectionId does not match the given value', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    collectionId__not: t.context.collectionId2,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch supports search which provider does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    provider__not: t.context.provider.name,
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 100,
    provider__not: 'providernotexist',
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('PdrSearch supports search which execution does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    execution__not: `https://example.com/${t.context.execution.arn}`,
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);

  queryStringParameters = {
    limit: 100,
    execution__not: 'executionnotexist',
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch supports search which checks existence of PDR field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    originalUrl__exists: 'true',
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('PdrSearch supports search which checks existence of collectionId', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    collectionId__exists: 'true',
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  queryStringParameters = {
    limit: 100,
    collectionId__exists: 'false',
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test('PdrSearch supports search which checks existence of provider', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    provider__exists: 'true',
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 100,
    provider__exists: 'false',
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test('PdrSearch supports search which checks existence of execution', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 100,
    execution__exists: 'true',
  };
  let dbSearch = new PdrSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 100,
    execution__exists: 'false',
  };
  dbSearch = new PdrSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('PdrSearch returns the correct record', async (t) => {
  const { knex } = t.context;
  const dbRecord = t.context.pdrs[2];
  const queryStringParameters = {
    limit: 100,
    pdrName: dbRecord.name,
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
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

  t.deepEqual(results?.[0], expectedApiRecord);
});

test('PdrSearch only returns count if countOnly is set to true', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    countOnly: 'true',
  };
  const dbSearch = new PdrSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.true(response.meta.count > 0, 'Expected response.meta.count to be greater than 0');
  t.is(response.results?.length, 0);
});
