'use strict';

const test = require('ava');
const mur = require('./fixtures/mur.json');
const { cloneDeep } = require('lodash');
const models = require('@cumulus/api/models');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const {
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');
const { discoverGranules } = require('../index');

let granuleModel;

test.before(async () => {
  process.env.GranulesTable = randomString();

  await models.Manager.createTable(process.env.GranulesTable, { name: 'granuleId', type: 'S' });

  granuleModel = new models.Granule();
});

test.after.always(async () => {
  await models.Manager.deleteTable(process.env.GranulesTable);
});

test.serial('discover granules sets the correct dataType for granules', async (t) => {
  const event = cloneDeep(mur);
  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
  };

  await validateConfig(t, event.config);

  const output = await discoverGranules(event);
  await validateOutput(t, output);

  // Make sure that there really were granules returned
  t.truthy(output.granules.length > 0);

  // Make sure that the granules use the collection name as the dataType
  output.granules.forEach((granule) => {
    t.is(granule.dataType, event.config.collection.name);
  });
});

// This test is broken and will be fixed by CUMULUS-427
test.skip('discover granules using FTP', async (t) => {
  const event = cloneDeep(mur);
  event.config.bucket = randomString();
  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.useList = true;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  await validateConfig(t, event.config);

  await s3().createBucket({ Bucket: event.config.bucket }).promise();

  try {
    const output = await discoverGranules(event);

    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  catch (e) {
    if (e.message.includes('getaddrinfo ENOTFOUND')) {
      t.pass('Ignoring this test. Test server seems to be down');
    }
    else t.fail(e);
  }
  finally {
    // Clean up
    await recursivelyDeleteS3Bucket(event.config.bucket);
  }
});

test.serial('discover granules using SFTP', async (t) => {
  const event = cloneDeep(mur);
  event.config.collection.provider_path = 'granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: 'localhost',
    port: 2222,
    username: 'user',
    password: 'password'
  };

  await validateConfig(t, event.config);

  const output = await discoverGranules(event);
  await validateOutput(t, output);
  t.is(output.granules.length, 3);
  t.is(output.granules[0].files.length, 2);
});

test.serial('discover granules using HTTP', async (t) => {
  const event = cloneDeep(mur);
  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
  };

  await validateConfig(t, event.config);

  const output = await discoverGranules(event);
  await validateOutput(t, output);
  t.is(output.granules.length, 3);
  t.is(output.granules[0].files.length, 2);
});

test.serial('discover granules using HTTP some granules are new', async (t) => {
  const event = cloneDeep(mur);
  event.config.collection.provider_path = '/granules/fake_granules';
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
  };

  await validateConfig(t, event.config);
  await granuleModel.create({
    granuleId: 'granule-1.nc',
    collectionId: event.config.collection.name,
    status: 'running',
    execution: 'some-link',
    createdAt: 42,
    productVolume: 42
  });
  await granuleModel.create({
    granuleId: 'granule-1.nc.md5',
    collectionId: event.config.collection.name,
    status: 'running',
    execution: 'some-link',
    createdAt: 42,
    productVolume: 42
  });

  try {
    const output = await discoverGranules(event);
    await validateOutput(t, output);
    t.is(output.granules.length, 2);
    t.is(output.granules[0].files.length, 2);
  }
  finally {
    Promise.all([
      granuleModel.delete({ granuleId: 'granule-1.nc' }),
      granuleModel.delete({ granuleId: 'granule-1.nc.md5' })
    ]);
  }
});

test.only('discover granules using S3', async (t) => {
  const sourceBucketName = randomString();
  const providerPath = randomString();

  // Create providerPathDirectory
  await s3().createBucket({ Bucket: sourceBucketName }).promise();

  // State sample files
  const files = [
    'granule-1.nc', 'granule-1.nc.md5',
    'granule-2.nc', 'granule-2.nc.md5',
    'granule-3.nc', 'granule-3.nc.md5'
  ];

  await Promise.all(files.map((file) =>
    s3().putObject({
      Bucket: sourceBucketName,
      Key: `${providerPath}/${file}`,
      Body: `This is ${file}`
    }).promise()));

  const event = cloneDeep(mur);
  event.config.collection.provider_path = providerPath;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 's3',
    host: sourceBucketName
  };

  await validateConfig(t, event.config);

  try {
    const output = await discoverGranules(event);
    console.log("discoveredGranules");
    await validateOutput(t, output);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  finally {
    // Clean up
    await recursivelyDeleteS3Bucket(sourceBucketName);
  }
});
