'use strict';

const test = require('ava');
const Mutex = require('../lib/Mutex');

test.beforeEach((t) => {
  t.context.sha = 'someSha';
  t.context.key = 'testKey';
  t.context.timeout = 123;
  t.context.tableName = 'sometable';
  t.context.getResults = {
    Item: { sha: t.context.sha, key: t.context.key, expire: t.context.timeout }
  };
  t.context.docClient = {
    get: () => ({ promise: () => t.context.getResults }),
    put: (params) => ({ promise: () => Promise.resolve(params) }),
    delete: () => ({ promise: () => true })
  };
  t.context.mutex = new Mutex(t.context.docClient, t.context.tableName);
});

test('Mutex.wrieLock() passes correct params to dynamo docClient', async (t) => {
  const key = t.context.key;
  const timeout = t.context.timeout;
  const sha = t.context.sha;

  const writeParams = {
    TableName: t.context.tableName,
    Item: {
      key: key,
      expire: 500 + timeout,
      sha: sha
    },
    ConditionExpression: '#key <> :key OR (#key = :key AND #expire < :expire)',
    ExpressionAttributeNames: {
      '#key': 'key',
      '#expire': 'expire'
    },
    ExpressionAttributeValues: {
      ':key': key,
      ':expire': 500
    }
  };

  const mutex = t.context.mutex;
  const result = await mutex.writeLock(key, timeout, sha);
  writeParams.Item.expire = result.Item.expire;
  writeParams.ExpressionAttributeValues[':expire'] = result.ExpressionAttributeValues[':expire'];
  t.deepEqual(result, writeParams);
});

test('Mutex.unlock() returns result from docClient', async (t) => {
  const key = t.context.key;
  const gitSHA = t.context.sha;
  const mutex = t.context.mutex;

  const result = await mutex.unlock(key, gitSHA);
  t.is(result, true);
});

test('Mutex.unlock() throws a CumulusLockError if there is a SHA mismatch', async (t) => {
  const key = t.context.key;
  const gitSha = t.context.sha;
  const docClient = t.context.docClient;
  const errorMessage = 'Cannot unlock stack, lock already exists from another build '
                       + 'with SHA someOtherSha, error: Error: test error';
  docClient.delete = () => {
    throw new Error('test error');
  };
  docClient.get = () => ({
    promise: () => ({
      Item: { sha: 'someOtherSha', key: t.context.key, expire: t.context.timeout }
    })
  });
  const mutex = new Mutex(docClient, 'sometable');
  await t.throwsAsync(
    () => mutex.unlock(key, gitSha),
    { name: 'CumulusLockError', message: errorMessage }
  );
});


test('Mutex.unlock() re-throws error from DynamoDb document client if checkMatchingSha returns a match or no lock', async (t) => {
  const key = t.context.key;
  const gitSha = t.context.sha;
  const docClient = t.context.docClient;
  docClient.delete = () => {
    throw new Error('test error');
  };
  docClient.get = () => ({
    promise: () => ({})
  });
  const mutex = new Mutex(docClient, 'sometable');
  await t.throwsAsync(
    () => mutex.unlock(key, gitSha),
    { name: 'Error', message: 'test error' }
  );
});

test('Mutex.checkMatchingSha() returns match on matching sha', async (t) => {
  const mutex = t.context.mutex;
  const result = await mutex.checkMatchingSha(t.context.key, t.context.sha);
  t.is(result, 'match');
});

test('Mutex.checkMatchingSha() returns collision sha on wrong sha', async (t) => {
  const collisionSha = 'someOtherSha';
  const getResults = t.context.getResults;
  getResults.promise = () => ({ Item: { sha: collisionSha } });
  const docClient = t.context.docClient;
  docClient.get = () => getResults;
  const mutex = new Mutex(docClient, 'someTable');

  const result = await mutex.checkMatchingSha(t.context.key, t.context.sha);
  t.is(result, collisionSha);
});

test('Mutex.checkMatchingSha() returns noLock if no lock existss', async (t) => {
  const getResults = t.context.getResults;
  getResults.promise = () => ({});
  const docClient = t.context.docClient;
  docClient.get = () => getResults;
  const mutex = new Mutex(docClient, 'someTable');
  const result = await mutex.checkMatchingSha(t.context.key, t.context.sha);
  t.is(result, 'noLock');
});
