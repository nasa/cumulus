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
  fakeProviderRecordFactory
} = require('../../dist');

const testDbName = `rule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
    const { knexAdmin, knex } = await generateLocalTestDb(
      testDbName,
      migrationDir
    );

    t.context.knexAdmin = knexAdmin;
    t.context.knex = knex;

    // Create a PG Collection
    t.context.collectionPgModel = new CollectionPgModel();
    t.context.testPgCollection = fakeCollectionRecordFactory(
      { cumulus_id: 0,
        name: 'testCollection',
        version: 8 }
    );

    await t.context.collectionPgModel.insert(
      t.context.knex,
      t.context.testPgCollection
    );

    t.context.collectionCumulusId = t.context.testPgCollection.cumulus_id;

    t.context.collectionId = constructCollectionId(
      t.context.testPgCollection.name,
      t.context.testPgCollection.version
    );

    // Create a Provider
    t.context.providerPgModel = new ProviderPgModel();
    t.context.testProvider = fakeProviderRecordFactory({
      name: 'testProvider',
    });

    const [pgProvider] = await t.context.providerPgModel.insert(
      t.context.knex,
      t.context.testProvider,
    );

    t.context.providerCumulusId = pgProvider.cumulus_id;

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
    const rules = [];
    t.context.rulePgModel = new RulePgModel();

    range(50).map((num) => (
      rules.push(fakeRuleRecordFactory({
        name: `fakeRule-${num}`,
        created_at: new Date(2017, 11, 31),
        updated_at: new Date(2018, 0, 1),
        enabled: num % 2 === 0 ? true : false,
        workflow: `testWorkflow-${num}`,
        collection_cumulus_id: t.context.collectionCumulusId,
        provider_cumulus_id: t.context.providerCumulusId,
      }))
    ));

    await t.context.rulePgModel.insert(
      t.context.knex,
      rules
    );
  });

  test.after.always(async (t) => {
    await destroyLocalTestDb({
      ...t.context,
      testDbName,
    });
  });

test('RuleSearch returns correct response for basic query', async (t) => {
  const { knex } = t.context;
  const dbSearch = new RuleSearch({});
  const results = await dbSearch.query(knex);
  t.is(results.meta.count, 50);
  t.is(results.results.length, 10);

  const expectedResponse1 = {
    name: 'fakeRule-0',
    createdAt: new Date(2017, 11, 31).getTime(),
    updatedAt: new Date(2018, 0, 1).getTime(),
    state: 'ENABLED',
    rule: {
      type: 'onetime',
    },
    workflow: 'testWorkflow-0',
    collection: {
      name: 'testCollection',
      version: '8',
    },
    provider: t.context.testProvider.name,
  };

  const expectedResponse10 = {
    name: 'fakeRule-9',
    createdAt: new Date(2017, 11, 31).getTime(),
    updatedAt: new Date(2018, 0, 1).getTime(),
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
  };

  t.deepEqual(results.results[0], expectedResponse1);
  t.deepEqual(results.results[9], expectedResponse10);
});

test('RuleSearchsupports page and limit params', async (t) => {
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
  let queryStringParameters = {
    limit: 10,
    workflow: 'testWorkflow-11',
  };
  let dbSearch = new RuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  console.log(response.results);
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
  let queryStringParameters = {
    limit: 10,
    prefix: 'fakeRule-1',
    state: 'DISABLED',
  };
  let dbSearch = new RuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);

  t.is(response.meta.count, 6);
  t.is(response.results?.length, 6);
});

test('RuleSearch supports sorting', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
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