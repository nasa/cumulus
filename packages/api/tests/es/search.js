'use strict';

const test = require('ava');
const rewire = require('rewire');
const esSearch = rewire('../../es/search');
const { Search } = esSearch;

const localEsHost = process.env.LOCAL_ES_HOST;
test.before(async () => {
  const awsMock = {
    config: {
      credentials: {
        user: 'test',
        password: 'testPassword'
      }
    }
  };
  esSearch.__set__('aws', awsMock);
  esSearch.__set__('inTestMode', () => false);
  delete process.env.LOCAL_ES_HOST;
});

test.after.always(() => {
  process.env.LOCAL_ES_HOST = localEsHost;
});

test('Configured with Metrics host when metrics propety is set', async (t) => {
  process.env.METRICS_ES_HOST = 'example.com';
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'password';

  const esClient = await Search.es(undefined, true);
  const connection = esClient.connectionPool;
  t.assert(connection);
  t.is(connection.connections.get('https://example.com/').url.origin, 'https://example.com');
  t.is(connection._auth.username, 'test');
  t.is(connection._auth.password, 'password');
});

test('Configured with default host when no metrics property is set', async (t) => {
  process.env.ES_HOST = 'example.com';

  const esClient = await Search.es();
  const connection = esClient.connectionPool;
  t.assert(connection);
  t.is(connection.connections.get('https://example.com/').url.origin, 'https://example.com');
});
