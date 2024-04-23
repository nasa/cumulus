'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const nock = require('nock');
const path = require('path');
const rewire = require('rewire');
const test = require('ava');
const { promisify } = require('util');
const { tmpdir } = require('os');
const { Readable } = require('stream');
const errors = require('@cumulus/errors');
const {
  calculateObjectHash,
  recursivelyDeleteS3Bucket,
  headObject,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const HttpProviderClient = rewire('../HttpProviderClient');

const testListWith = (discoverer, event, ...args) => {
  class Crawler extends EventEmitter {
    start() {
      this.emit(event, ...args);
    }
  }

  return HttpProviderClient.__with__({
    Crawler,
  })(() => discoverer.list(''));
};

test.before((t) => {
  t.context.httpProviderClient = new HttpProviderClient({
    protocol: 'http',
    host: 'localhost',
    port: 3030,
  });
});

test.afterEach(() => {
  nock.cleanAll();
});

test.serial('sync() downloads remote file to s3 with correct content-type', async (t) => {
  const bucket = randomString();
  const key = randomString();
  const expectedContentType = 'application/x-hdf';
  try {
    await s3().createBucket({ Bucket: bucket });
    const { s3uri, etag } = await t.context.httpProviderClient.sync({
      fileRemotePath: '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
      destinationBucket: bucket,
      destinationKey: key,
    });
    t.truthy(s3uri, 'Missing s3uri');
    t.truthy(etag, 'Missing etag');
    t.true(await s3ObjectExists({
      Bucket: bucket,
      Key: key,
    }));
    const sum = await calculateObjectHash({
      s3: s3(),
      algorithm: 'CKSUM',
      bucket,
      key,
    });
    t.is(sum, '1435712144');

    const s3HeadResponse = await headObject(bucket, key);
    t.is(expectedContentType, s3HeadResponse.ContentType);
  } finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});

test.serial('list() returns expected files', async (t) => {
  const responseBody = '<html><body><a href="file.txt">asdf</a></body></html>';

  const actualFiles = await testListWith(
    t.context.httpProviderClient,
    'fetchcomplete',
    {},
    Buffer.from(responseBody),
    {}
  );

  const expectedFiles = [{ name: 'file.txt', path: '' }];

  t.deepEqual(actualFiles, expectedFiles);
});

test.serial('list() returns files for provider with link tags in uppercase', async (t) => {
  const responseBody = '<html><body><A HREF="test.txt">test.txt</A></body></html>';

  const actualFiles = await testListWith(
    t.context.httpProviderClient,
    'fetchcomplete',
    {},
    Buffer.from(responseBody),
    {}
  );

  const expectedFiles = [{ name: 'test.txt', path: '' }];

  t.deepEqual(actualFiles, expectedFiles);
});

test.serial('list() returns files for provider with multiple links on a single source line', async (t) => {
  const responseBody = `
  <html><body>
  <A HREF="test.txt">test.txt</A><A HREF="test2.txt">test2.txt</A>
  </body></html>
  `;

  const actualFiles = await testListWith(
    t.context.httpProviderClient,
    'fetchcomplete',
    {},
    Buffer.from(responseBody),
    {}
  );

  const expectedFiles = [
    { name: 'test.txt', path: '' },
    { name: 'test2.txt', path: '' },
  ];

  t.deepEqual(actualFiles, expectedFiles);
});

test.serial('list() returns all files for provider from multiple source lines', async (t) => {
  const responseBody = `
  <html><body>
  <A HREF="test.txt">test.txt</A>
  <A HREF="test2.txt">test2.txt</A>
  </body></html>
  `;

  const actualFiles = await testListWith(
    t.context.httpProviderClient,
    'fetchcomplete',
    {},
    Buffer.from(responseBody),
    {}
  );

  const expectedFiles = [
    { name: 'test.txt', path: '' },
    { name: 'test2.txt', path: '' },
  ];

  t.deepEqual(actualFiles, expectedFiles);
});

test.serial('list() strips path from file names', async (t) => {
  const responseBody = '<html><body><A HREF="/path/to/file/test.txt">test.txt</A></body></html>';

  class Crawler extends EventEmitter {
    start() {
      this.emit('fetchcomplete', {}, Buffer.from(responseBody));
    }
  }

  const actualFiles = await HttpProviderClient.__with__({
    Crawler,
  })(() => t.context.httpProviderClient.list('/path/to/file/'));

  const expectedFiles = [{ name: 'test.txt', path: '/path/to/file/' }];

  t.deepEqual(actualFiles, expectedFiles);
});

test.serial('list() strips trailing spaces from name', async (t) => {
  const responseBody = '<html><body><a href="file.txt ">asdf</a></body></html>';

  const actualFiles = await testListWith(
    t.context.httpProviderClient,
    'fetchcomplete',
    {},
    Buffer.from(responseBody),
    {}
  );

  const expectedFiles = [{ name: 'file.txt', path: '' }];

  t.deepEqual(actualFiles, expectedFiles);
});

test.serial('list() does not strip leading spaces from name', async (t) => {
  const responseBody = '<html><body><a href=" file.txt ">asdf</a></body></html>';

  const actualFiles = await testListWith(
    t.context.httpProviderClient,
    'fetchcomplete',
    {},
    Buffer.from(responseBody),
    {}
  );

  const expectedFiles = [{ name: ' file.txt', path: '' }];

  t.deepEqual(actualFiles, expectedFiles);
});

test.serial('list() returns a valid exception if the connection times out', async (t) => {
  await t.throwsAsync(
    () => testListWith(t.context.httpProviderClient, 'fetchtimeout', {}, 100),
    { message: 'Connection timed out' }
  );
});

test.serial('list() returns an exception with helpful information if a fetcherror event occurs', async (t) => {
  // The QueueItem that gets returned by the 'fetcherror' event
  const queueItem = { url: 'http://localhost/asdf' };

  // The http.IncomingMessage that gets returned by the 'fetcherror' event
  let nextChunk = 'Login required';
  const response = new Readable({
    read() {
      this.push(nextChunk);
      // eslint-disable-next-line unicorn/no-null
      nextChunk = null;
    },
  });

  response.statusCode = 401;
  response.req = { method: 'GET' };

  const err = await t.throwsAsync(
    () => testListWith(t.context.httpProviderClient, 'fetcherror', queueItem, response)
  );

  t.true(err.message.includes('401'));
  t.is(err.details, 'Login required');
});

test.serial('list() returns an exception if a fetchclienterror event occurs', async (t) => {
  await t.throwsAsync(
    () => testListWith(t.context.httpProviderClient, 'fetchclienterror'),
    { message: 'Connection Error: undefined' }
  );
});

test.serial('list() returns an exception if a fetch404 event occurs', async (t) => {
  const err = await t.throwsAsync(
    () => testListWith(t.context.httpProviderClient, 'fetch404', { foo: 'bar' })
  );

  t.true(err.message.includes('Received a 404 error'));
  t.deepEqual(err.details, { foo: 'bar' });
});

test.serial('download() downloads a file', async (t) => {
  const { httpProviderClient } = t.context;
  const localPath = path.join(tmpdir(), randomString());
  try {
    await httpProviderClient.download({ remotePath: 'pdrs/PDN.ID1611071307.PDR', localPath });
    t.is(await promisify(fs.access)(localPath), undefined);
  } finally {
    await promisify(fs.unlink)(localPath);
  }
});

test.serial('list succeeds if server wait time is unexpectedly slow', async (t) => {
  const httpProviderClient = new HttpProviderClient({
    protocol: 'http',
    host: 'localhost',
    port: 3030,
    httpListTimeout: 1005,
  });

  nock('http://localhost:3030')
    .replyContentLength()
    .get('/test_url')
    .times(1)
    .delay(1000)
    .reply(200, '<html><a href="foo.pdr">foo.pdr</a>\n<a href="bar.pdr">bar.pdr</a></html>');

  const result = await httpProviderClient.list('test_url');
  t.deepEqual(
    [
      { path: 'test_url', name: 'foo.pdr' },
      { path: 'test_url', name: 'bar.pdr' },
    ],
    result
  );
});

test.serial('list fails if client wait time is set less than the response delay', async (t) => {
  const httpProviderClient = new HttpProviderClient({
    protocol: 'http',
    host: 'testhost',
    port: 3030,
    httpListTimeout: 1,
  });

  nock('http://testhost:3030')
    .replyContentLength()
    .get('/test_url')
    .delay(1005)
    .times(1)
    .reply(200, '');

  await t.throwsAsync(
    async () => await httpProviderClient.list('test_url'),
    {
      message: 'Connection timed out',
      instanceOf: errors.RemoteResourceError,
    }
  );
});

test.serial('upload() attempts to upload a file', async (t) => {
  const localPath = path.join(tmpdir(), randomString());
  t.teardown(() => fs.unlinkSync(localPath));
  const uploadPath = path.join(randomString(), 'destinationfile.txt');
  fs.writeFileSync(localPath, randomString());

  const { httpProviderClient } = t.context;
  nock('http://localhost:3030')
    .post(path.join('/', uploadPath))
    .reply(200);

  // This text fixture is a workaround to an ongoing issue with
  // got/pipeline/msw & nock in node 20.  Integration tests
  // must cover the full use case
  const readStream = new Readable({
    read(item) {
      this.push(JSON.stringify(item));
    },
  });
  readStream.push('foobar');
  readStream.push(null);
  await httpProviderClient.upload({ localPath, uploadPath, test: { readStream } });
  t.true(nock.isDone());
});
