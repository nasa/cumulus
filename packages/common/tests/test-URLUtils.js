'use strict';

const test = require('ava');

const { buildURL } = require('../URLUtils');

test('buildURL() returns a correct S3 URL', (t) => {
  t.is(
    buildURL({
      protocol: 's3',
      host: 'my-bucket'
    }),
    's3://my-bucket'
  );
});

test('buildURL() returns a correct http URL for port 80', (t) => {
  t.is(
    buildURL({
      protocol: 'http',
      host: 'my-host',
      port: 80
    }),
    'http://my-host'
  );
});

test('buildURL() returns a correct http URL for a non-standard port', (t) => {
  t.is(
    buildURL({
      protocol: 'http',
      host: 'my-host',
      port: 81
    }),
    'http://my-host:81'
  );
});

test('buildURL() returns a correct http URL for a port specified as a string', (t) => {
  t.is(
    buildURL({
      protocol: 'http',
      host: 'my-host',
      port: '81'
    }),
    'http://my-host:81'
  );
});

test('buildURL() returns the correct path with a single', (t) => {
  t.is(
    buildURL({
      protocol: 'http',
      host: 'my-host',
      path: 'file.txt'
    }),
    'http://my-host/file.txt'
  );
});

test('buildURL() returns the correct path with multiple paths', (t) => {
  t.is(
    buildURL({
      protocol: 'http',
      host: 'my-host',
      path: ['some', 'file.txt']
    }),
    'http://my-host/some/file.txt'
  );
});

test('buildURL() normalizes slashes in paths', (t) => {
  t.is(
    buildURL({
      protocol: 'http',
      host: 'my-host',
      path: ['some/', '/file.txt']
    }),
    'http://my-host/some/file.txt'
  );
});
