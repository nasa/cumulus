'use strict';

const fs = require('fs');
const { basename, dirname } = require('path');
const test = require('ava');
const S3 = require('@cumulus/aws-client/S3');
// const errors = require('@cumulus/errors');
const { randomId } = require('@cumulus/common/test-utils');
const { BlobServiceClient } = require('@azure/storage-blob');
const AzureProviderClient = require('../AzureProviderClient');

const localPath = './tmp.json';

const blobStorageConnectionString = 'UseDevelopmentStorage=true';
const blobServiceClient = BlobServiceClient.fromConnectionString(blobStorageConnectionString);

test.before(async (t) => {
  t.context.sourceContainer = randomId('sourceContainer');
  t.context.sourcePrefix = randomId('sourcePrefix');
  t.context.sourceKey = `${t.context.sourcePrefix}/${randomId('sourceKey')}`;
  t.context.targetBucket = randomId('targetBucket');
  t.context.fileContent = JSON.stringify({ type: 'fake-test-object' });

  const containerClient = blobServiceClient.getContainerClient(t.context.sourceContainer);
  t.context.containerClient = containerClient;

  await Promise.all([
    t.context.containerClient.create(),
    S3.createBucket(t.context.targetBucket),
  ]);

  t.context.sourceBlobClient = t.context.containerClient.getBlockBlobClient(t.context.sourceKey);
  await t.context.sourceBlobClient.upload(
    t.context.fileContent,
    t.context.fileContent.length
  );
});

test.after.always(async (t) => {
  await Promise.all([
    t.context.containerClient.delete(),
    S3.recursivelyDeleteS3Bucket(t.context.targetBucket),
  ]);
});

test.serial('AzureProviderClient.list lists objects from the bucket root with paths', async (t) => {
  const azureProviderClient = new AzureProviderClient({
    container: t.context.sourceContainer,
    connectionString: blobStorageConnectionString,
  });

  const files = await azureProviderClient.list('');

  t.is(files.length, 1);
  t.is(files[0].name, basename(t.context.sourceKey));
  t.is(files[0].path, dirname(t.context.sourceKey));
});

test.serial('AzureProviderClient.list lists objects under a path in a bucket', async (t) => {
  const azureProviderClient = new AzureProviderClient({
    container: t.context.sourceContainer,
    connectionString: blobStorageConnectionString,
  });

  const files = await azureProviderClient.list(t.context.sourcePrefix);
  t.is(files.length, 1);
  t.is(files[0].name, basename(t.context.sourceKey));
});

test.serial('AzureProviderClient.download downloads a file to local disk', async (t) => {
  const azureProviderClient = new AzureProviderClient({
    container: t.context.sourceContainer,
    connectionString: blobStorageConnectionString,
  });

  await azureProviderClient.download(t.context.sourceKey, localPath);
  t.true(fs.existsSync(localPath));
  t.is(fs.readFileSync(localPath).toString(), t.context.fileContent);
  fs.unlinkSync(localPath);
});

test.serial('AzureProviderClient.sync syncs a file to a target S3 location', async (t) => {
  const azureProviderClient = new AzureProviderClient({
    container: t.context.sourceContainer,
    connectionString: blobStorageConnectionString,
  });
  const targetKey = 'target.json';

  const { s3uri, etag } = await azureProviderClient.sync(
    t.context.sourceKey,
    t.context.targetBucket,
    targetKey
  );
  t.truthy(s3uri, 'Missing s3uri');
  t.truthy(etag, 'Missing etag');
  t.is(
    await S3.getTextObject(t.context.targetBucket, targetKey),
    t.context.fileContent
  );
});

// test.serial('AzureProviderClient.sync throws an error if the source file does not exist', async (t) => {
//   const azureProviderClient = new AzureProviderClient({ bucket: t.context.sourceContainer });

//   await t.throwsAsync(
//     azureProviderClient.sync('non-existent', t.context.targetBucket, 'target.json'),
//     {
//       instanceOf: errors.FileNotFound,
//       message: `Source file not found s3://${t.context.sourceContainer}/non-existent`,
//     }
//   );
// });
