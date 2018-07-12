'use strict';

const test = require('ava');
const fs = require('fs');
const path = require('path');
const { randomString } = require('@cumulus/common/test-utils');
const { deleteAliases } = require('../lib/testUtils');
const indexer = require('../es/indexer');
const { Search } = require('../es/search');
const { bootstrapElasticSearch } = require('../lambdas/bootstrap');

const esIndex = randomString();
process.env.ES_INDEX = esIndex;
let esClient;

test.before(async () => {
  await deleteAliases();
  await bootstrapElasticSearch('fakehost', esIndex);
  esClient = await Search.es();
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });
});

test.serial('indexing log messages', async (t) => {
  // input log events
  const inputtxt = fs.readFileSync(path.join(__dirname, '/data/log_events_input.txt'), 'utf8');
  const event = JSON.parse(JSON.parse(inputtxt.toString()));
  const response = await indexer.indexLog(esClient, event.logEvents);
  t.false(response.errors);
  t.is(response.items.length, 5);

  await esClient.indices.refresh();

  // expected result in elastic search
  const estxt = fs.readFileSync(path.join(__dirname, '/data/log_events_expected.json'), 'utf8');
  const expected = JSON.parse(estxt.toString());
  // records are in elasticsearch
  const records = await esClient.mget({
    index: esIndex,
    type: 'logs',
    body: {
      ids: event.logEvents.map((r) => r.id)
    }
  });

  t.is(records.docs.length, 5);

  // check message of each record
  records.docs.forEach((record) => {
    const expectedRecord = expected.docs.find((r) => r._id === record._id);
    t.is(expectedRecord._source.level, record._source.level);
    t.is(expectedRecord._source.message, record._source.message);
  });
});
