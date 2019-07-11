'use strict';

const fs = require('fs');
const nock = require('nock');
const os = require('os');
const path = require('path');
const test = require('ava');
const { promisify } = require('util');

const http = require('../../http');
const { randomString } = require('../../test-utils');

const readFile = promisify(fs.readFile);

const deleteFile = (file) => {
  const pUnlink = promisify(fs.unlink);
  return pUnlink(file)
    .catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
};

test.beforeEach((t) => {
  t.context.destination = path.join(os.tmpdir(), `delete-me-${randomString()}.txt`);
});

test('http.download writes a file to disk', async (t) => {
  nock('http://www.example.com')
    .get('/hello.txt')
    .reply(200, 'hello');

  await http.download('http://www.example.com/hello.txt', t.context.destination);

  const result = await readFile(t.context.destination, 'utf-8');

  t.is('hello', result);
});

test('http.download returns a rejected Promise if the file does not exist', async (t) => {
  nock('http://www.example.com')
    .get('/hello.txt')
    .reply(404);

  const error = await t.throwsAsync(
    () => http.download('http://www.example.com/hello.txt', t.context.destination)
  );

  t.is(error.name, 'HTTPError');
  t.is(error.statusCode, 404);
});

test('http.download returns a rejected Promise if an internal server error is received', async (t) => {
  nock('http://www.example.com')
    .get('/hello.txt')
    .reply(500, 'Internal Server Error');

  const error = await t.throwsAsync(
    () => http.download('http://www.example.com/hello.txt', t.context.destination)
  );

  t.is(error.name, 'HTTPError');
  t.is(error.statusCode, 500);
});

test('http.download handles redirects', async (t) => {
  nock('http://www.example.com')
    .get('/1.txt')
    .reply(301, 'Moved', { Location: 'http://www.example.com/hello.txt' });

  nock('http://www.example.com')
    .get('/hello.txt')
    .reply(200, 'hello');

  await http.download('http://www.example.com/1.txt', t.context.destination);

  const result = await readFile(t.context.destination, 'utf-8');

  t.is('hello', result);
});

test.afterEach.always((t) => deleteFile(t.context.destination));
