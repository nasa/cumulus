'use strict';

const test = require('ava');
const knex = require('knex');
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
  providersS3TableSql,
  rulesS3TableSql,
} = require('../../dist/s3search/s3TableSchemas');
const { RuleS3Search } = require('../../dist/s3search/RuleS3Search');
const {
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  fakeRuleRecordFactory,
} = require('../../dist');

test.before(async (t) => {
  t.context.knexBuilder = knex({ client: 'pg' });

  // Create PG Collections
  t.context.testPgCollection = fakeCollectionRecordFactory(
    { cumulus_id: 0,
      name: 'testCollection',
      version: 8 }
  );
  t.context.testPgCollection2 = fakeCollectionRecordFactory(
    { cumulus_id: 1,
      name: 'testCollection2',
      version: 4 }
  );

  t.context.collectionCumulusId = t.context.testPgCollection.cumulus_id;
  t.context.collectionCumulusId2 = t.context.testPgCollection2.cumulus_id;

  t.context.collectionId = constructCollectionId(
    t.context.testPgCollection.name,
    t.context.testPgCollection.version
  );
  t.context.collectionId2 = constructCollectionId(
    t.context.testPgCollection2.name,
    t.context.testPgCollection2.version
  );

  // Create a Provider
  t.context.testProvider = fakeProviderRecordFactory({
    cumulus_id: random(1, 100),
    name: 'testProvider',
  });
  t.context.testProvider2 = fakeProviderRecordFactory({
    cumulus_id: random(101, 200),
    name: 'testProvider2',
  });

  t.context.providerCumulusId = t.context.testProvider.cumulus_id;
  t.context.providerCumulusId2 = t.context.testProvider2.cumulus_id;

  t.context.duration = 100;

  // Create a lot of Rules
  t.context.ruleSearchFields = {
    createdAt: new Date(2017, 11, 31),
    updatedAt: new Date(2018, 0, 1),
    updatedAt2: new Date(2018, 0, 2),
  };

  const rules = range(50).map((num) => fakeRuleRecordFactory({
    cumulus_id: num,
    name: `fakeRule-${num}`,
    created_at: t.context.ruleSearchFields.createdAt,
    updated_at: (num % 2) ?
      t.context.ruleSearchFields.updatedAt : t.context.ruleSearchFields.updatedAt2,
    enabled: num % 2 === 0,
    workflow: `testWorkflow-${num}`,
    queue_url: (num % 2) ? 'https://sqs.us-east-1.amazonaws.com/123/456' : null,
    collection_cumulus_id: (num % 2)
      ? t.context.collectionCumulusId : t.context.collectionCumulusId2,
    provider_cumulus_id: (num % 2)
      ? t.context.providerCumulusId : t.context.providerCumulusId2,
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
  const providers = [t.context.testProvider, t.context.testProvider2];
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'providers',
    providersS3TableSql,
    providers,
    `${duckdbS3Prefix}providers.parquet`
  );

  console.log('create rules');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'rules',
    rulesS3TableSql,
    rules,
    `${duckdbS3Prefix}rules.parquet`
  );
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.testBucket);
  await t.context.connection.closeSync();
});

test.serial('RuleS3Search returns the correct response for a basic query', async (t) => {
  const { connection } = t.context;
  const dbSearch = new RuleS3Search({}, connection);
  const results = await dbSearch.query();
  t.is(results.meta.count, 50);
  t.is(results.results.length, 10);

  const expectedResponse1 = {
    name: 'fakeRule-0',
    createdAt: t.context.ruleSearchFields.createdAt.getTime(),
    updatedAt: t.context.ruleSearchFields.updatedAt2.getTime(),
    state: 'ENABLED',
    rule: {
      type: 'onetime',
    },
    workflow: 'testWorkflow-0',
    collection: {
      name: 'testCollection2',
      version: '4',
    },
    provider: t.context.testProvider2.name,
  };

  const expectedResponse10 = {
    name: 'fakeRule-9',
    createdAt: t.context.ruleSearchFields.createdAt.getTime(),
    updatedAt: t.context.ruleSearchFields.updatedAt.getTime(),
    state: 'DISABLED',
    rule: {
      type: 'onetime',
    },
    workflow: 'testWorkflow-9',
    collection: {
      name: 'testCollection',
      version: '8',
    },
    provider: t.context.testProvider.name,
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/456',
  };

  t.deepEqual(results.results[0], expectedResponse1);
  t.deepEqual(results.results[9], expectedResponse10);
});

test.serial('RuleS3Search supports page and limit params', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 25,
    page: 2,
  };
  let dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 10,
    page: 5,
  };
  dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 0);
});

test.serial('RuleS3Search supports infix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    infix: 'Rule-27',
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('RuleS3Search supports prefix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    prefix: 'fakeRule-1',
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 11);
  t.is(response.results?.length, 11);
});

test.serial('RuleS3Search supports term search for string field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 10,
    workflow: 'testWorkflow-11',
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('RuleS3Search non-existing fields are ignored', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('RuleS3Search returns fields specified', async (t) => {
  const { connection } = t.context;
  const fields = 'state,name';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((rule) => t.deepEqual(Object.keys(rule), fields.split(',')));
});

test.serial('RuleS3Search supports search for multiple fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 10,
    prefix: 'fakeRule-1',
    state: 'DISABLED',
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  t.is(response.meta.count, 6);
  t.is(response.results?.length, 6);
});

test.serial('RuleS3Search supports sorting', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    sort_by: 'workflow',
    order: 'desc',
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results[0].workflow > response.results[10].workflow);
  t.true(response.results[1].workflow > response.results[30].workflow);
});

test.serial('RuleS3Search supports collectionId term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    collectionId: t.context.collectionId,
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('RuleS3Search supports provider term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    provider: t.context.testProvider.name,
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('RuleS3Search supports term search for date field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    updatedAt: t.context.ruleSearchFields.updatedAt,
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('RuleS3Search supports term search for boolean field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    state: 'ENABLED', // maps to the bool field "enabled"
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('RuleS3Search supports term search for timestamp', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp: t.context.ruleSearchFields.updatedAt, //maps to timestamp
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('RuleS3Search supports range search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp__from: t.context.ruleSearchFields.timestamp,
    timestamp__to: t.context.ruleSearchFields.timestamp + 1600,
  };
  const dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('RuleS3Search supports search which checks existence of queue URL field', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    queueUrl__exists: 'true',
  };
  let dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 200,
    queueUrl__exists: 'false',
  };
  dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('RuleS3Search supports collectionId terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId2, constructCollectionId('fakecollectionterms', 'v1')].join(','),
  };
  let dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId, t.context.collectionId2].join(','),
  };
  dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('RuleS3Search supports search which provider does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    provider__not: t.context.testProvider.name,
  };
  let dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 200,
    provider__not: 'providernotexist',
  };
  dbSearch = new RuleS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});
