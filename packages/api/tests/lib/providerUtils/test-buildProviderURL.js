'use strict';

const test = require('ava');

const { fakeProviderFactory } = require('../../../lib/testUtils');
const { buildProviderURL } = require('../../../lib/providerUtils');

test('buildProviderURL() returns a correct S3 URL', (t) => {
  const provider = fakeProviderFactory({
    protocol: 's3',
    host: 'my-bucket'
  });

  t.is(
    buildProviderURL(provider),
    's3://my-bucket'
  );
});

test('buildProviderURL() returns a correct http URL for port 80', (t) => {
  const provider = fakeProviderFactory({
    protocol: 'http',
    host: 'my-host',
    port: 80
  });

  t.is(
    buildProviderURL(provider),
    'http://my-host'
  );
});

test('buildProviderURL() returns a correct http URL for port 80', (t) => {
  const provider = fakeProviderFactory({
    protocol: 'http',
    host: 'my-host',
    port: 81
  });

  t.is(
    buildProviderURL(provider),
    'http://my-host:81'
  );
});
