'use strict';

const errors = require('@cumulus/errors');
const test = require('ava');
const sinon = require('sinon');

const { collections: collectionsApi } = require('@cumulus/api-client');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  randomString,
  validateConfig,
  validateInput,
  validateOutput,
} = require('@cumulus/common/test-utils');

const { streamTestData } = require('@cumulus/test-data');

const { parsePdr } = require('..');

test.before((t) => {
  t.context.sandbox = sinon.createSandbox();
  t.context.getCollectionsStub = sinon.stub(collectionsApi, 'getCollection');
});

test.beforeEach(async (t) => {
  t.context.payload = {
    config: {
      stack: randomString(),
      bucket: randomString(),
      provider: {},
    },
    input: {
      pdr: {
        name: 'MOD09GQ.PDR',
        path: '/pdrs',
      },
    },
  };

  await s3().createBucket({ Bucket: t.context.payload.config.bucket });

  const collectionConfig = {
    name: 'MOD09GQ',
    granuleIdExtraction: '^(.*)\.hdf',
  };

  t.context.getCollectionsStub.withArgs({
    prefix: t.context.payload.config.stack,
    collectionName: 'MOD09GQ',
    collectionVersion: '006',
  }).resolves(collectionConfig);
});

test.after.always((t) => {
  t.context.sandbox.restore();
});

const testGranule = {
  granuleId: 'MOD09GQ.A2017224.h09v02.006.2017227165020',
  dataType: 'MOD09GQ',
  granuleSize: 17909733,
};

const testHdfFile = {
  type: 'data',
  path: '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA',
  size: 17865615,
  checksumType: 'CKSUM',
  checksum: 4208254019,
};

const testMetFile = {
  path: '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA',
  size: 44118,
  type: 'metadata',
};

test.afterEach(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.payload.config.bucket);
});

test.serial('parse PDR from FTP endpoint', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
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
    Object.keys(testGranule).forEach((key) => t.is(granule[key], testGranule[key]));

    const hdfFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
    Object.keys(testHdfFile).forEach((key) => t.is(testHdfFile[key], hdfFile[key]));

    const metFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
    Object.keys(testMetFile).forEach((key) => t.is(testMetFile[key], metFile[key]));
  } catch (error) {
    if (error instanceof errors.RemoteResourceError || error.name === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    } else t.fail(error);
  }
});

test.serial('parse PDR from HTTP endpoint', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: '127.0.0.1',
    port: 3030,
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
    Object.keys(testGranule).forEach((key) => t.is(granule[key], testGranule[key]));

    const hdfFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
    t.truthy(hdfFile);
    Object.keys(testHdfFile).forEach((key) => {
      t.is(testHdfFile[key], hdfFile[key]);
    });

    const metFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
    t.truthy(metFile);
    Object.keys(testMetFile).forEach((key) => t.is(testMetFile[key], metFile[key]));
  } catch (error) {
    if (error instanceof errors.RemoteResourceError || error.name === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    } else t.fail(error);
  }
});

test.serial('parse PDR from SFTP endpoint', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    password: 'password',
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
    Object.keys(testGranule).forEach((key) => t.is(granule[key], testGranule[key]));

    const hdfFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
    t.truthy(hdfFile);
    Object.keys(testHdfFile).forEach((key) => t.is(testHdfFile[key], hdfFile[key]));

    const metFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
    t.truthy(metFile);
    Object.keys(testMetFile).forEach((key) => t.is(testMetFile[key], metFile[key]));
  } catch (error) {
    if (error instanceof errors.RemoteResourceError || error.name === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    } else t.fail(error);
  }
});

test.serial('Parse a PDR from an S3 provider', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString(),
  };
  t.context.payload.input.pdr.path = '/pdrs';

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  await s3().createBucket({ Bucket: t.context.payload.config.provider.host });

  try {
    await s3().putObject({
      Bucket: t.context.payload.config.provider.host,
      Key: `${t.context.payload.input.pdr.path}/${t.context.payload.input.pdr.name}`,
      Body: streamTestData('pdrs/MOD09GQ.PDR'),
    });

    const output = await parsePdr(t.context.payload);

    await validateOutput(t, output);

    t.deepEqual(output.pdr, t.context.payload.input.pdr);
    t.is(output.granules.length, 1);
    t.is(output.granulesCount, 1);
    t.is(output.filesCount, 2);
    t.is(output.totalSize, 17909733);

    const granule = output.granules[0];
    Object.keys(testGranule).forEach((key) => t.is(granule[key], testGranule[key]));

    const hdfFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
    Object.keys(testHdfFile).forEach((key) => t.is(testHdfFile[key], hdfFile[key]));

    const metFile = granule.files.find((f) =>
      f.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
    Object.keys(testMetFile).forEach((key) => t.is(testMetFile[key], metFile[key]));
  } catch (error) {
    if (error instanceof errors.RemoteResourceError || error.name === 'AllAccessDisabled') {
      t.pass('ignoring this test. Test server seems to be down');
    } else t.fail(error);
  } finally {
    await recursivelyDeleteS3Bucket(t.context.payload.config.provider.host);
  }
});

test.serial('Parse a PDR without a granuleIdFilter in the config', async (t) => {
  // Create the collections contained in this PDR
  t.context.getCollectionsStub.withArgs({
    prefix: t.context.payload.config.stack,
    collectionName: 'MYG29_S1D_SIR',
    collectionVersion: '006',
  }).resolves({ name: 'MYG29_S1D_SIR', granuleIdExtraction: '^(.*)\.tar.gz' });
  t.context.getCollectionsStub.withArgs({
    prefix: t.context.payload.config.stack,
    collectionName: 'MYG29_N1D_SIR',
    collectionVersion: '006',
  }).resolves({ name: 'MYG29_N1D_SIR', granuleIdExtraction: '^(.*)\.tar.gz' });

  // Set up the task config
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
  };
  t.context.payload.config.useList = true;

  // Set up the task input
  t.context.payload.input.pdr.name = 'MODAPSops7.1234567.PDR';

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  const output = await parsePdr(t.context.payload);

  await validateOutput(t, output);

  t.deepEqual(output.pdr, t.context.payload.input.pdr);
  t.is(output.granules.length, 2);
  t.is(output.granulesCount, 2);
  t.is(output.filesCount, 2);
  t.is(output.totalSize, 3952643);
});

test.serial('Empty FILE_ID value in PDR, parse-pdr throws error', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString(),
  };
  t.context.payload.input.pdr.path = '/pdrs';

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  await s3().createBucket({ Bucket: t.context.payload.config.provider.host });

  await s3().putObject({
    Bucket: t.context.payload.config.provider.host,
    Key: `${t.context.payload.input.pdr.path}/${t.context.payload.input.pdr.name}`,
    Body: streamTestData('pdrs/MOD09GQ-without-file-id-value.PDR'),
  });

  await t.throwsAsync(
    () => parsePdr(t.context.payload),
    { message: "Failed to parse value ('') of FILE_ID" },
    'Value corresponding to FILE_ID key in the PDR is empty'
  );
});

test.serial('Missing FILE_ID in PDR, parse-pdr throws error', async (t) => {
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: randomString(),
  };
  t.context.payload.input.pdr.path = '/pdrs';

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  await s3().createBucket({ Bucket: t.context.payload.config.provider.host });

  await s3().putObject({
    Bucket: t.context.payload.config.provider.host,
    Key: `${t.context.payload.input.pdr.path}/${t.context.payload.input.pdr.name}`,
    Body: streamTestData('pdrs/MOD09GQ-without-file-id.PDR'),
  });

  await t.throwsAsync(
    () => parsePdr(t.context.payload),
    { message: 'FILE_ID' },
    'FILE_ID Key is not present in the supplied PDR'
  );
});

test.serial('Parse a PDR with a granuleIdFilter in the config', async (t) => {
  // Create the collections contained in this PDR
  t.context.getCollectionsStub.withArgs({
    prefix: t.context.payload.config.stack,
    collectionName: 'MYG29_S1D_SIR',
    collectionVersion: '006',
  }).resolves({ name: 'MYG29_S1D_SIR', granuleIdExtraction: '^(.*)\.tar.gz' });
  t.context.getCollectionsStub.withArgs({
    prefix: t.context.payload.config.stack,
    collectionName: 'MYG29_N1D_SIR',
    collectionVersion: '006',
  }).resolves({ name: 'MYG29_N1D_SIR', granuleIdExtraction: '^(.*)\.tar.gz' });

  // Set up the task config
  t.context.payload.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
  };
  t.context.payload.config.useList = true;
  t.context.payload.config.granuleIdFilter = '^MYG29_S1D_SIR.A2012254.tiled.006.2018082201326\..*';

  // Set up the task input
  t.context.payload.input.pdr.name = 'MODAPSops7.1234567.PDR';

  await validateInput(t, t.context.payload.input);
  await validateConfig(t, t.context.payload.config);

  const output = await parsePdr(t.context.payload);

  await validateOutput(t, output);

  t.deepEqual(output.pdr, t.context.payload.input.pdr);
  t.is(output.granules.length, 1);
  t.is(output.granulesCount, 1);
  t.is(output.filesCount, 1);
  t.is(output.totalSize, 1503297);
});
