'use strict';

const errors = require('@cumulus/common/errors');
const fs = require('fs-extra');
const test = require('ava');

const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');

const { CollectionConfigStore } = require('@cumulus/common');
const {
  randomString,
  validateConfig,
  validateInput,
  validateOutput
} = require('@cumulus/common/test-utils');

const { parsePdr } = require('../index');

test.beforeEach(async (t) => {
  t.context.payload = {
    config: {
      stack: randomString(),
      internalBucket: randomString(),
      provider: {}
    },
    input: {
      pdr: {
        name: 'MOD09GQ.PDR',
        path: '/pdrs'
      }
    }
  };

  await s3().createBucket({ Bucket: t.context.payload.config.internalBucket }).promise();

  const collectionConfig = {
    name: 'MOD09GQ',
    granuleIdExtraction: '^(.*)\.hdf'
  };

  const collectionConfigStore = new CollectionConfigStore(
    t.context.payload.config.internalBucket,
    t.context.payload.config.stack
  );
  await collectionConfigStore.put('MOD09GQ', collectionConfig);
});

test.afterEach(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.payload.config.internalBucket);
});

test('parse PDR from FTP endpoint', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };
  t.context.payload.config.useList = true;

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  let output;
  try {
    output = await parsePdr(t.context.payload);

    await validateOutput(t, output);

    t.deepEqual(output.pdr, t.context.payload.input.pdr);
    t.is(output.granules.length, 1);
    t.is(output.granulesCount, 1);
    t.is(output.filesCount, 2);
    t.is(output.totalSize, 17909733);

    const granule = output.granules[0];
    t.is(granule.granuleId, 'MOD09GQ.A2017224.h09v02.006.2017227165020');
    t.is(granule.dataType, 'MOD09GQ');
    t.is(granule.granuleSize, 17909733);

    const hdfFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
    t.truthy(hdfFile);
    t.is(hdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
    t.is(hdfFile.fileSize, 17865615);
    t.is(hdfFile.checksumType, 'CKSUM');
    t.is(hdfFile.checksumValue, 4208254019);

    const metFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
    t.truthy(metFile);
    t.is(metFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
    t.is(metFile.fileSize, 44118);
  }
  catch (err) {
    if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else t.fail(err);
  }
});

test('parse PDR from HTTP endpoint', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
  };

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  let output;
  try {
    output = await parsePdr(t.context.payload);

    await validateOutput(t, output);

    t.deepEqual(output.pdr, t.context.payload.input.pdr);
    t.is(output.granules.length, 1);
    t.is(output.granulesCount, 1);
    t.is(output.filesCount, 2);
    t.is(output.totalSize, 17909733);

    const granule = output.granules[0];
    t.is(granule.granuleId, 'MOD09GQ.A2017224.h09v02.006.2017227165020');
    t.is(granule.dataType, 'MOD09GQ');
    t.is(granule.granuleSize, 17909733);

    const hdfFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
    t.truthy(hdfFile);
    t.is(hdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
    t.is(hdfFile.fileSize, 17865615);
    t.is(hdfFile.checksumType, 'CKSUM');
    t.is(hdfFile.checksumValue, 4208254019);

    const metFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
    t.truthy(metFile);
    t.is(metFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
    t.is(metFile.fileSize, 44118);
  }
  catch (err) {
    if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else t.fail(err);
  }
});

test('parse PDR from SFTP endpoint', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: 'localhost',
    port: 2222,
    username: 'user',
    password: 'password'
  };

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  let output;
  try {
    output = await parsePdr(t.context.payload);

    await validateOutput(t, output);

    t.deepEqual(output.pdr, t.context.payload.input.pdr);
    t.is(output.granules.length, 1);
    t.is(output.granulesCount, 1);
    t.is(output.filesCount, 2);
    t.is(output.totalSize, 17909733);

    const granule = output.granules[0];
    t.is(granule.granuleId, 'MOD09GQ.A2017224.h09v02.006.2017227165020');
    t.is(granule.dataType, 'MOD09GQ');
    t.is(granule.granuleSize, 17909733);

    const hdfFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
    t.truthy(hdfFile);
    t.is(hdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
    t.is(hdfFile.fileSize, 17865615);
    t.is(hdfFile.checksumType, 'CKSUM');
    t.is(hdfFile.checksumValue, 4208254019);

    const metFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
    t.truthy(metFile);
    t.is(metFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
    t.is(metFile.fileSize, 44118);
  }
  catch (err) {
    if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else t.fail(err);
  }
});

test('Parse a PDR from an S3 provider', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString()
  };
  t.context.payload.input.pdr.path = '/pdrs';

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  await s3().createBucket({ Bucket: t.context.payload.config.provider.host }).promise();

  try {
    await s3().putObject({
      Bucket: t.context.payload.config.provider.host,
      Key: `${t.context.payload.input.pdr.path}/${t.context.payload.input.pdr.name}`,
      Body: fs.createReadStream('../../packages/test-data/pdrs/MOD09GQ.PDR')
    }).promise();

    const output = await parsePdr(t.context.payload);

    await validateOutput(t, output);

    t.deepEqual(output.pdr, t.context.payload.input.pdr);
    t.is(output.granules.length, 1);
    t.is(output.granulesCount, 1);
    t.is(output.filesCount, 2);
    t.is(output.totalSize, 17909733);

    const granule = output.granules[0];
    t.is(granule.granuleId, 'MOD09GQ.A2017224.h09v02.006.2017227165020');
    t.is(granule.dataType, 'MOD09GQ');
    t.is(granule.granuleSize, 17909733);

    const hdfFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
    t.truthy(hdfFile);
    t.is(hdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
    t.is(hdfFile.fileSize, 17865615);
    t.is(hdfFile.checksumType, 'CKSUM');
    t.is(hdfFile.checksumValue, 4208254019);

    const metFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
    t.truthy(metFile);
    t.is(metFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
    t.is(metFile.fileSize, 44118);
  }
  catch (err) {
    if (err instanceof errors.RemoteResourceError || err.code === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    }
    else t.fail(err);
  }
  finally {
    await recursivelyDeleteS3Bucket(t.context.payload.config.provider.host);
  }
});
