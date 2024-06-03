'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { ExecutionSearch } = require('../../dist/search/ExecutionSearch');

const {
  generateLocalTestDb,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  migrationDir,
  fakeExecutionRecordFactory,
  ExecutionPgModel,
} = require('../../dist');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.executionPgModel = new ExecutionPgModel();

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: 'UnknownError' }, { Error: 'CumulusMessageAdapterError' }, { Error: 'IngestFailure' }, { Error: 'CmrFailure' }, {}];
  const collections = [];
  const executions = [];

  range(20).map((num) => (
    collections.push(fakeCollectionRecordFactory({
      name: 'testCollection',
      version: `${num}`,
      cumulus_id: num,
    }))
  ));

  range(40).map((num) => (
    executions.push(fakeExecutionRecordFactory({
      collection_cumulus_id: num % 20,
      status: statuses[(num % 3) + 1],
      error: errors[num % 5],
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
    }))
  ));

  await t.context.collectionPgModel.insert(
    t.context.knex,
    collections
  );

  await t.context.executionPgModel.insert(
    t.context.knex,
    executions
  );
});

test('ExecutionSearch returns correct response for basic query', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new ExecutionSearch({});
  const results = await AggregateSearch.query(knex);
  console.log(results);
  t.is(results.meta.count, 40);
});
