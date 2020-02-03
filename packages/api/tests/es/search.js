'use strict';

const test = require('ava');
const { Search } = require('../../es/search');

test.serial('Configured with Metrics host when metrics propety is set', async (t) => {
  process.env.METRICS_ES_HOST = 'example.com';
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'password';

  const esClient = await Search.es(null, true, false);
  const connection = esClient.connectionPool;
  t.assert(connection);
  t.is(connection.connections.get('https://example.com/').url.origin, 'https://example.com');
  t.is(connection._auth.username, 'test');
  t.is(connection._auth.password, 'password');
});

test('Configured with default host when no metrics property is set', async (t) => {
  process.env.ES_HOST = 'example.com';

  const esClient = await Search.es(null, false, false);
  const connection = esClient.connectionPool;
  t.assert(connection);
  t.is(connection.connections.get('https://example.com/').url.origin, 'https://example.com');
});
