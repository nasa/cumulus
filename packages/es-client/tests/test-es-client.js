'use strict';

// Unset local configuration
// Must be set prior to requiring AWS module/subdependency
const setupTestEnvs = () => {
  process.env.NODE_ENV = 'notTestingTotallyNotTesting';
  const accessKeyId = 'ACCESS_KEY';
  process.env.AWS_ACCESS_KEY_ID = accessKeyId;
  const secretAccessKey = 'SECRET_KEY';
  process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_ACCOUNT_ID;
  delete process.env.LOCAL_ES_HOST;
  delete process.env.METRICS_ES_HOST;
  delete process.env.METRICS_ES_USER;
  delete process.env.METRICS_ES_PASS;
};
setupTestEnvs();

const test = require('ava');
const { EsClient, sanitizeSensitive, isError } = require('../search');

test.afterEach(() => {
  setupTestEnvs();
});

test.serial('EsClient is created with credentialed ES client with expected auth/endpoint configuration', async (t) => {
  const esClient = new EsClient();
  await esClient.initializeEsClient();

  const connection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  const awsCreds = connection[1];
  const connectionUri = connection[0];
  t.is(awsCreds.accessKeyId, process.env.AWS_ACCESS_KEY_ID);
  t.is(awsCreds.secretAccessKey, process.env.AWS_SECRET_ACCESS_KEY);
  t.is(connectionUri, 'http://localhost:9200/');
});

test.serial('EsClient is created with credentialed ES client with expected auth/endpoint configuration if host is specified', async (t) => {
  const esClient = new EsClient('nasa.gov');
  await esClient.initializeEsClient();

  const connection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  const awsCreds = connection[1];
  const connectionUri = connection[0];
  t.is(esClient.host, 'nasa.gov');
  t.is(connectionUri, 'https://nasa.gov/');
  t.is(awsCreds.accessKeyId, process.env.AWS_ACCESS_KEY_ID);
  t.is(awsCreds.secretAccessKey, process.env.AWS_SECRET_ACCESS_KEY);
});

test.serial('EsClient is created with credentialed ES client with expected auth/endpoint configuration if metrics is specified', async (t) => {
  process.env.METRICS_ES_HOST = 'localhost/metrics';
  process.env.METRICS_ES_USER = 'metricsUser';
  process.env.METRICS_ES_PASS = 'metricsPass';
  const esClient = new EsClient('nasa.gov', true);
  await esClient.initializeEsClient();
  const connection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  const connectionUri = connection[0];
  t.is(esClient.host, 'localhost/metrics');
  t.is(connectionUri, 'https://localhost/metrics');
  t.is(connection[1].awsAccessKeyId, undefined);
});

test.serial('EsClient initialization fails if metrics is specified but required environment variables are unset', async (t) => {
  delete process.env.METRICS_ES_HOST;
  delete process.env.METRICS_ES_USER;
  delete process.env.METRICS_ES_PASS;
  const esClient = new EsClient(undefined, true);
  await t.throwsAsync(
    esClient.initializeEsClient(),
    undefined,
    'ELK Metrics stack not configured'
  );
});

test.serial('EsClient refreshClient() does nothing if metrics is set to true for class instance', async (t) => {
  process.env.METRICS_ES_HOST = 'localhost/metrics';
  process.env.METRICS_ES_USER = 'metricsUser';
  process.env.METRICS_ES_PASS = 'metricsPass';
  const esClient = new EsClient(undefined, true);
  await esClient.initializeEsClient();
  const originalConnection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  process.env.AWS_ACCESS_KEY_ID = 'NEW_KEY_ID';
  esClient.refreshClient();
  const connection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  t.is(originalConnection[1].awsAccessKeyId, undefined);
  t.is(connection[1].accessKeyId, undefined);
});

test.serial('EsClient refreshClient() refreshes client credentials upon AWS credential chain change', async (t) => {
  const esClient = new EsClient();
  await esClient.initializeEsClient();
  process.env.AWS_ACCESS_KEY_ID = 'NEW_KEY_ID';
  await esClient.refreshClient();
  const connection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  t.is(connection[1].accessKeyId, 'NEW_KEY_ID');
});

test.serial('EsClient refreshClient() does not refresh client credentials if AWS credentials have not changed', async (t) => {
  const esClient = new EsClient();
  await esClient.initializeEsClient();
  const connection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  t.is(connection[1].accessKeyId, 'ACCESS_KEY');
  await esClient.refreshClient();
  const newConnection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  t.is(newConnection[1].accessKeyId, 'ACCESS_KEY');
});

test.serial('EsClient is created with credentialed ES client with expected auth/endpoint configuration when in test mode', async (t) => {
  process.env.LOCAL_ES_HOST = 'testLocalHost';
  const esClient = new EsClient();
  await esClient.initializeEsClient();

  const connection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  const awsCreds = connection[1].credentials;
  const connectionUri = connection[0];
  t.is(awsCreds, undefined);
  t.is(connectionUri, 'http://testlocalhost:9200/');
  t.like(connection[1].ssl, { rejectUnauthorized: false });
});

test.serial('EsClient successfully connects with URL-encoded username and password', async (t) => {
  process.env.METRICS_ES_HOST = 'localhost/metrics';
  process.env.METRICS_ES_USER = 'user%40example.com';
  process.env.METRICS_ES_PASS = 'pass%40word';
  const esClient = new EsClient(undefined, true);
  await esClient.initializeEsClient();
  const connection = Array.from(esClient.client.transport.connectionPool.connections)[0];
  const connectionUri = connection[0];
  t.is(esClient.host, 'localhost/metrics');
  t.is(connectionUri, 'https://localhost/metrics');
  t.is(connection[1].awsAccessKeyId, undefined);
  // Optionally, verify connectivity (requires a running ES instance or mock)
  // await t.notThrowsAsync(esClient.client.ping());
});

// Add tests for sanitizeSensitive
test('sanitizeSensitive sanitizes string input with URL-encoded username and password', (t) => {
  process.env.METRICS_ES_USER = 'user%40example.com';
  process.env.METRICS_ES_PASS = 'pass%40word';
  const input = 'Error: Failed to connect with user%40example.com:pass%40word';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with *****');
});

test('sanitizeSensitive sanitizes string input with sensitive fields containing special characters', (t) => {
  process.env.METRICS_ES_USER = 'test.user';
  process.env.METRICS_ES_PASS = 'secret.pass@123';
  const input = 'Error: Failed to connect with test.user:secret.pass@123';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with *****');
});

test('sanitizeSensitive sanitizes string input with regex special characters in password', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'pass.word*+?[]{}';
  const input = 'Error: Failed to connect with test:pass.word*+?[]{}';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with *****');
});

test('sanitizeSensitive returns unchanged string when no sensitive fields', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'secret.pass@123';
  const input = 'Error: Failed to connect';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect');
});

test('sanitizeSensitive sanitizes Error object with sensitive fields containing special characters', (t) => {
  process.env.METRICS_ES_USER = 'test.user';
  process.env.METRICS_ES_PASS = 'secret.pass@123';
  const error = new Error('Failed to connect with test.user:secret.pass@123');
  const originalStack = error.stack;
  const result = sanitizeSensitive(error);
  t.is(result.message, 'Failed to connect with *****');
  t.is(result.stack, originalStack);
  t.true(isError(result));
});

test('sanitizeSensitive sanitizes Error object with regex special characters in password', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'pass.word*+?[]{}';
  const error = new Error('Failed to connect with test:pass.word*+?[]{}');
  const originalStack = error.stack;
  const result = sanitizeSensitive(error);
  t.is(result.message, 'Failed to connect with *****');
  t.is(result.stack, originalStack);
  t.true(isError(result));
});

test('sanitizeSensitive handles Error with no sensitive fields', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'secret.pass@123';
  const error = new Error('Failed to connect');
  const originalStack = error.stack;
  const result = sanitizeSensitive(error);
  t.is(result.message, 'Failed to connect');
  t.is(result.stack, originalStack);
  t.true(isError(result));
});

test('sanitizeSensitive handles undefined sensitive fields', (t) => {
  delete process.env.METRICS_ES_USER;
  delete process.env.METRICS_ES_PASS;
  const input = 'Error: Failed to connect';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect');
});

test('sanitizeSensitive sanitizes Error with no message property and special characters', (t) => {
  process.env.METRICS_ES_USER = 'test.user';
  process.env.METRICS_ES_PASS = 'secret.pass@123';
  const error = { toString: () => 'Failed to connect with test.user:secret.pass@123', stack: 'stack trace' };
  const result = sanitizeSensitive(error);
  t.is(result.message, 'Failed to connect with *****');
  t.is(result.stack, 'stack trace');
  t.true(isError(result));
});

test('sanitizeSensitive handles empty password', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = '';
  const input = 'Error: Failed to connect with test:';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with *****');
});

test('sanitizeSensitive handles password with only special characters', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = '***';
  const input = 'Error: Failed to connect with test:***';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with *****');
});

test('sanitizeSensitive sanitizes multiple occurrences of sensitive fields', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'secret.pass@123';
  const input = 'Error: Failed to connect with test:secret.pass@123 and test:secret.pass@123';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with ***** and *****');
});

test('sanitizeSensitive handles partial matches correctly', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'secret';
  const input = 'Error: Failed to connect with test:secretive';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with test:secretive');
});

test('sanitizeSensitive does not sanitize password alone', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'secret';
  const input = 'Error: Failed to connect with secret';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with secret');
});

test('sanitizeSensitive handles partial matches with special characters', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'pass.word';
  const input = 'Error: Failed to connect with test:pass.wordy';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with test:pass.wordy');
});

test('sanitizeSensitive sanitizes field with surrounding punctuation', (t) => {
  process.env.METRICS_ES_USER = 'test';
  process.env.METRICS_ES_PASS = 'secret';
  const input = 'Error: Failed to connect with test:secret, test:secretive';
  const result = sanitizeSensitive(input);
  t.is(result, 'Error: Failed to connect with *****, test:secretive');
});
