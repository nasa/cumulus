'use strict';

const os = require('os');
const fs = require('fs-extra');
const nock = require('nock');
const path = require('path');
const test = require('ava');
const { promisify } = require('util');

const { fetchMessageAdapter } = require('../lib/adapter');

const pStat = promisify(fs.stat);

const gitPath = 'nasa/cumulus-message-adapter';

test.before(() => {
  nock.disableNetConnect();
  nock.enableNetConnect('localhost');

  nock('https://api.github.com')
    .get('/repos/nasa/cumulus-message-adapter/releases/latest')
    .query(true)
    .reply(
      200,
      { tag_name: 'v1.2.3' }
    );

  nock('https://github.com')
    .get('/nasa/cumulus-message-adapter/releases/download/v1.2.3/cumulus-message-adapter.zip')
    .query(true)
    .replyWithFile(200, './test/fixtures/zipfile-fixture.zip');
});

test.beforeEach((t) => {
  t.context.temp = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
  t.context.src = path.join(t.context.temp, 'adapter.zip');
  t.context.dest = path.join(t.context.temp, 'adapter');
});

test.afterEach.always('final cleanup', async (t) => {
  await fs.remove(t.context.temp);
});

test.after.always(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

test('fetchMessageAdapter() downloads the latest version of the message adapter', async (t) => {
  const unzipped = await fetchMessageAdapter(
    null,
    gitPath,
    'cumulus-message-adapter.zip',
    t.context.src,
    t.context.dest
  );

  t.truthy(await pStat(unzipped));

  t.is(unzipped, t.context.dest);

  t.true(await fs.pathExists(t.context.src));
});

test('fetchMessageAdapter() can download a specific version if provided', async (t) => {
  const scope = nock('https://github.com')
    .get('/nasa/cumulus-message-adapter/releases/download/v1.0.0/cumulus-message-adapter.zip')
    .query(true)
    .replyWithFile(200, './test/fixtures/zipfile-fixture.zip');

  await fetchMessageAdapter(
    'v1.0.0',
    gitPath,
    'cumulus-message-adapter.zip',
    t.context.src,
    t.context.dest
  );

  t.true(scope.isDone());
});

test('fetchMessageAdapter() throws na exception if the version does not exist', async (t) => {
  nock('https://github.com')
    .get('/nasa/cumulus-message-adapter/releases/download/v999.0.0/cumulus-message-adapter.zip')
    .query(true)
    .reply(404);

  try {
    await fetchMessageAdapter(
      'v999.0.0',
      gitPath,
      'cumulus-message-adapter.zip',
      t.context.src,
      t.context.dest
    );

    t.fail('Expected an exception to be thrown');
  } catch (err) {
    t.pass();
  }
});
