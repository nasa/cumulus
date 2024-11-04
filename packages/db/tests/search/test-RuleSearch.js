'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { RuleSearch } = require('../../dist/search/RuleSearch');

const {
  AsyncOperationPgModel,
  CollectionPgModel,
  destroyLocalTestDb,
  fakeAsyncOperationRecordFactory,
  fakeCollectionRecordFactory,
  fakeRuleRecordFactory,
  generateLocalTestDb,
  migrationDir,
  RulePgModel,
  ProviderPgModel,
  fakeProviderRecordFactory,
} = require('../../dist');

const testDbName = `rule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  // Create PG Collections
  t.context.collectionPgModel = new CollectionPgModel();
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

  await t.context.collectionPgModel.insert(
    t.context.knex,
    t.context.testPgCollection
  );

  await t.context.collectionPgModel.insert(
    t.context.knex,
    t.context.testPgCollection2
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
  t.context.providerPgModel = new ProviderPgModel();
  t.context.testProvider = fakeProviderRecordFactory({
    name: 'testProvider',
  });
  t.context.testProvider2 = fakeProviderRecordFactory({
    name: 'testProvider2',
  });

  const [pgProvider] = await t.context.providerPgModel.insert(
    t.context.knex,
    t.context.testProvider
  );
  const [pgProvider2] = await t.context.providerPgModel.insert(
    t.context.knex,
    t.context.testProvider2
  );

  t.context.providerCumulusId = pgProvider.cumulus_id;
  t.context.providerCumulusId2 = pgProvider2.cumulus_id;

  // Create an Async Operation
  t.context.asyncOperationsPgModel = new AsyncOperationPgModel();
  t.context.testAsyncOperation = fakeAsyncOperationRecordFactory({ cumulus_id: 140 });
  t.context.asyncCumulusId = t.context.testAsyncOperation.cumulus_id;

  await t.context.asyncOperationsPgModel.insert(
    t.context.knex,
    t.context.testAsyncOperation
  );

  t.context.duration = 100;

  // Create a lot of Rules
  t.context.ruleSearchFields = {
    createdAt: new Date(2017, 11, 31),
    updatedAt: new Date(2018, 0, 1),
    updatedAt2: new Date(2018, 0, 2),
  };
  t.context.rulePgModel = new RulePgModel();
  const rules = range(50).map((num) => fakeRuleRecordFactory({
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
  await t.context.rulePgModel.insert(t.context.knex, rules);
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('RuleSearch returns the correct response for a basic query', async (t) => {
  const { knex } = t.context;
  const dbSearch = new RuleSearch({});
  const results = await dbSearch.query(knex);
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

test('RuleSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 25,
    page: 2,
  };
  let dbSearch = new RuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 10,
    page: 5,
  };
  dbSearch = new RuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new RuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 0);
});

test('RuleSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    infix: 'Rule-27',
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('RuleSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    prefix: 'fakeRule-1',
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 11);
  t.is(response.results?.length, 11);
});

test('RuleSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 10,
    workflow: 'testWorkflow-11',
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('RuleSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('RuleSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  const fields = 'state,name';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((rule) => t.deepEqual(Object.keys(rule), fields.split(',')));
});

test('RuleSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 10,
    prefix: 'fakeRule-1',
    state: 'DISABLED',
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);

  t.is(response.meta.count, 6);
  t.is(response.results?.length, 6);
});

test('RuleSearch supports sorting', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    sort_by: 'workflow',
    order: 'desc',
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results[0].workflow > response.results[10].workflow);
  t.true(response.results[1].workflow > response.results[30].workflow);
});

test('RuleSearch supports collectionId term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    collectionId: t.context.collectionId,
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('RuleSearch supports provider term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    provider: t.context.testProvider.name,
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('RuleSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    updatedAt: t.context.ruleSearchFields.updatedAt,
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('RuleSearch supports term search for boolean field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    state: 'ENABLED', // maps to the bool field "enabled"
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('RuleSearch supports term search for timestamp', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp: t.context.ruleSearchFields.updatedAt, //maps to timestamp
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('RuleSearch supports range search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp__from: t.context.ruleSearchFields.timestamp,
    timestamp__to: t.context.ruleSearchFields.timestamp + 1600,
  };
  const dbSearch = new RuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);

  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('RuleSearch supports search which checks existence of queue URL field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    queueUrl__exists: 'true',
  };
  let dbSearch = new RuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 200,
    queueUrl__exists: 'false',
  };
  dbSearch = new RuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('RuleSearch supports collectionId terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId2, constructCollectionId('fakecollectionterms', 'v1')].join(','),
  };
  let dbSearch = new RuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId, t.context.collectionId2].join(','),
  };
  dbSearch = new RuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('RuleSearch supports search which provider does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    provider__not: t.context.testProvider.name,
  };
  let dbSearch = new RuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 200,
    provider__not: 'providernotexist',
  };
  dbSearch = new RuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});
