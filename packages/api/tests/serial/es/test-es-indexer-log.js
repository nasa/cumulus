'use strict';

const test = require('ava');
const fs = require('fs');
const path = require('path');
const { randomString } = require('@cumulus/common/test-utils');
const { deleteAliases } = require('../../../lib/testUtils');
const indexer = require('../../../es/indexer');
const { Search } = require('../../../es/search');
const queries = require('../../../es/queries');
const { bootstrapElasticSearch } = require('../../../lambdas/bootstrap');

const esIndex = randomString();
process.env.ES_INDEX = esIndex;
let esClient;

test.before(async () => {
  await deleteAliases();
  await bootstrapElasticSearch('fakehost', esIndex);
  esClient = await Search.es();
  process.env.esIndex = esIndex;
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });
});

test.serial('indexing log messages', async (t) => {
  // input log events
  const inputtxt = fs.readFileSync(path.join(__dirname, '../../data/log_events_input.txt'), 'utf8');
  const event = JSON.parse(JSON.parse(inputtxt.toString()));
  const response = await indexer.indexLog(esClient, event.logEvents);
  t.false(response.errors);
  t.is(response.items.length, 5);

  await esClient.indices.refresh();
  // console.log(JSON.stringify(response, null, 2));
  // expected result in elastic search
  const estxt = fs.readFileSync(path.join(__dirname, '../../data/log_events_expected.json'), 'utf8');
  const expected = JSON.parse(estxt.toString());
  // records are in elasticsearch
  const records = await esClient.mget({
    index: esIndex,
    type: 'logs',
    body: {
      ids: event.logEvents.map((r) => r.id)
    }
  });
  // console.log(JSON.stringify(records, null, 2));
  t.is(records.docs.length, 5);

  // check level, executions, and message of each record
  records.docs.forEach((record) => {
    const expectedRecord = expected.docs.find((r) => r._id === record._id);
    t.is(expectedRecord._source.level, record._source.level);
    t.is(expectedRecord._source.message, record._source.message);
    if (expectedRecord._source.executions) {
      t.is(expectedRecord._source.executions, record._source.executions);
    }
  });
  const searchParams = {
    limit: 50,
    'executions.keyword': '157de51a-bc7d-4766-b419-a2c1c09f9207'
  };
  const body = queries(searchParams);
  const searchRecord = await esClient.search({
    index: esIndex,
    type: 'logs',
    body
  });
  t.is(searchRecord.hits.total, 2);
});
