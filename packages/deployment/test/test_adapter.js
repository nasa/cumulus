
/* eslint-disable no-console, no-param-reassign */
'use strict';

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const { fetchMessageAdapter } = require('../lib/adapter');

const gitPath = 'nasa/cumulus-message-adapter';

test.beforeEach((t) => {
  t.context.temp = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
  t.context.src = path.join(t.context.temp, 'adapter.zip');
  t.context.dest = path.join(t.context.temp, 'adapter');
});

test('downloaded latest version of the message adapter', async (t) => {
  // create temp directory
  const unzipped = await fetchMessageAdapter(
    null,
    gitPath,
    'cumulus-message-adapter.zip',
    t.context.src,
    t.context.dest
  );

  // confirm the zip file exist
  const dirExists = fs.statSync(unzipped);
  t.truthy(dirExists);
  t.is(unzipped, t.context.dest);

  // confirm the extracted folder exists
  t.true(await fs.pathExists(t.context.src));
});

test('should download specific version if provided', async (t) => {
  const version = 'v1.0.0';
  // create temp directory
  const unzipped = await fetchMessageAdapter(
    version,
    gitPath,
    'cumulus-message-adapter.zip',
    t.context.src,
    t.context.dest
  );
  // confirm the zip file exist
  const dirExists = fs.statSync(unzipped);
  t.truthy(dirExists);
  t.is(unzipped, t.context.dest);

  // confirm version number
  const versionFile = path.join(t.context.dest, 'message_adapter/version.py');
  const versionString = fs.readFileSync(versionFile).toString();
  const rTest = /v[\d]\.[\d]\.[\d]/;
  t.true(rTest.test(versionString));
});

test('should crash if the version is wrong', async (t) => {
  const version = 'v450.0.0';
  // create temp directory
  const promise = fetchMessageAdapter(
    version,
    gitPath,
    'cumulus-message-adapter.zip',
    t.context.src,
    t.context.dest
  );
  await t.throws(promise);
});

test.afterEach.always('final cleanup', async(t) => {
  // delete the temp directory
  await fs.remove(t.context.temp);
});
