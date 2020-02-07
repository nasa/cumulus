'use strict';

const KMS = require('@cumulus/aws-client/KMS');
const S3 = require('@cumulus/aws-client/S3');
const test = require('ava');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');

const Provider = require('../../models/providers');
const { fakeProviderFactory } = require('../../lib/testUtils');
const { handler } = require('../../lambdas/verifyProviderSecretsMigration');

test.before(async () => {
  process.env.stackName = randomString();

  process.env.system_bucket = randomString();
  await S3.createBucket(process.env.system_bucket);

  await S3.putFile(
    process.env.system_bucket,
    `${process.env.stackName}/crypto/public.pub`,
    require.resolve('@cumulus/test-data/keys/s3_key_pair_provider_public.pub')
  );

  await S3.putFile(
    process.env.system_bucket,
    `${process.env.stackName}/crypto/private.pem`,
    require.resolve('@cumulus/test-data/keys/s3_key_pair_provider_private.pem')
  );

  const createKeyResponse = await KMS.createKey();
  process.env.provider_kms_key_id = createKeyResponse.KeyMetadata.KeyId;
});

test.beforeEach(async (t) => {
  process.env.ProvidersTable = randomString();

  t.context.providerModel = new Provider();

  await t.context.providerModel.createTable();
});

test.afterEach.always((t) => t.context.providerModel.deleteTable());

test.after.always(() => S3.recursivelyDeleteS3Bucket(process.env.system_bucket));

test.serial('verifyProviderSecretsMigration passes if empty credentials are found', async (t) => {
  const provider = fakeProviderFactory({
    protocol: 'ftp',
    encrypted: false
  });

  delete provider.username;
  delete provider.password;

  await dynamodbDocClient().put({
    TableName: process.env.ProvidersTable,
    Item: { ...provider, createdAt: Date.now() }
  }).promise();

  await t.notThrowsAsync(handler());
});

test.serial('verifyProviderSecretsMigration passes if KMS credentials are found', async (t) => {
  const { providerModel } = t.context;

  const provider = fakeProviderFactory({
    protocol: 'ftp',
    username: 'my-username',
    password: 'my-password'
  });

  await providerModel.create(provider);

  await t.notThrowsAsync(handler());
});

test.serial('verifyProviderSecretsMigration fails if plaintext credentials are found', async (t) => {
  const provider = fakeProviderFactory({
    protocol: 'ftp',
    encrypted: false,
    username: 'my-username',
    password: 'my-password'
  });

  await dynamodbDocClient().put({
    TableName: process.env.ProvidersTable,
    Item: { ...provider, createdAt: Date.now() }
  }).promise();

  const err = await t.throwsAsync(handler());

  t.is(
    err.message,
    `Provider ${provider.id} has plaintext username or password. Must invoke the providerSecretsMigration Lambda function.`
  );
});

test.serial('verifyProviderSecretsMigration fails if S3 keypair credentials are found', async (t) => {
  const provider = fakeProviderFactory({
    protocol: 'ftp',
    encrypted: true,
    username: await S3KeyPairProvider.encrypt('my-username'),
    password: await S3KeyPairProvider.encrypt('my-password')
  });

  await dynamodbDocClient().put({
    TableName: process.env.ProvidersTable,
    Item: { ...provider, createdAt: Date.now() }
  }).promise();

  await t.throwsAsync(handler());
});

test.serial('verifyProviderSecretsMigration verifies all providers', async (t) => {
  const { providerModel } = t.context;

  const kmsProvider = fakeProviderFactory({
    protocol: 'ftp',
    username: 'my-username',
    password: 'my-password'
  });

  await providerModel.create(kmsProvider);

  const s3Provider = fakeProviderFactory({
    protocol: 'ftp',
    encrypted: true,
    username: await S3KeyPairProvider.encrypt('my-username'),
    password: await S3KeyPairProvider.encrypt('my-password')
  });

  await dynamodbDocClient().put({
    TableName: process.env.ProvidersTable,
    Item: { ...s3Provider, createdAt: Date.now() }
  }).promise();

  await t.throwsAsync(handler());
});
