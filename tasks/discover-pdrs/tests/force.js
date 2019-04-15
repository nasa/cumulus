'use strict';

const test = require('ava');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { RemoteResourceError } = require('@cumulus/common/errors');

const { discoverPdrs } = require('..');

const { recursivelyDeleteS3Bucket, s3, uploadS3Files } = require('@cumulus/common/aws');
const {
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');

test.beforeEach(async (t) => {
  const inputPath = path.join(__dirname, 'fixtures', 'input.json');
  const rawInput = await fs.readFile(inputPath, 'utf8');
  t.context.event = JSON.parse(rawInput);
});

test('test pdr discovery with force=false', async (t) => {
  const { event } = t.context;

  event.config.bucket = randomString();
  event.config.stack = randomString();
  event.config.collection.provider_path = '/pdrs/discover-pdrs';
  event.config.useList = true;
  event.config.force = false;

  event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass'
  };

  await validateConfig(t, event.config);

  const tmpDir = os.tmpdir();

  await s3().createBucket({ Bucket: event.config.bucket }).promise();

  try {
    const output = await discoverPdrs(event);

    await validateOutput(t, output);

    t.is(output.pdrs.length, 5);

    const files = output.pdrs.map((pdr) => {
      const pdrFileName = path.join(tmpDir, pdr.name);
      fs.writeFileSync(pdrFileName, 'PDR DATA');
      return pdrFileName;
    });

    await uploadS3Files(files, event.config.bucket, path.join(event.config.stack, 'pdrs'));

    // do it again and we should not find a pdr
    const output2 = await discoverPdrs(event);

    await validateOutput(t, output2);

    t.is(output2.pdrs.length, 0);
  } catch (err) {
    if (err instanceof RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    } else t.fail(err);
  } finally {
    await recursivelyDeleteS3Bucket(event.config.bucket);
  }
});

test('test pdr discovery with force=true', async (t) => {
  const { event } = t.context;

  event.config.bucket = randomString();
  event.config.stack = randomString();
  event.config.collection.provider_path = '/pdrs/discover-pdrs';
  event.config.useList = true;
  event.config.force = true;

  event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass'
  };

  await validateConfig(t, event.config);

  const tmpDir = os.tmpdir();

  await s3().createBucket({ Bucket: event.config.bucket }).promise();

  try {
    const output = await discoverPdrs(event);

    await validateOutput(t, output);

    t.is(output.pdrs.length, 5);

    const files = output.pdrs.map((pdr) => {
      const pdrFileName = path.join(tmpDir, pdr.name);
      fs.writeFileSync(pdrFileName, 'PDR DATA');
      return pdrFileName;
    });

    await uploadS3Files(files, event.config.bucket, path.join(event.config.stack, 'pdrs'));

    // do it again and we should find all pdrs
    const output2 = await discoverPdrs(event);

    await validateOutput(t, output2);

    t.is(output2.pdrs.length, 5);
  } catch (err) {
    if (err instanceof RemoteResourceError) {
      t.pass('ignoring this test. Test server seems to be down');
    } else t.fail(err);
  } finally {
    await recursivelyDeleteS3Bucket(event.config.bucket);
  }
});
