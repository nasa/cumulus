'use strict';

const test = require('ava');
const KMS = require('@cumulus/aws-client/KMS');
const S3 = require('@cumulus/aws-client/S3');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');

const Provider = require('../../models/providers');
const { fakeProviderFactory } = require('../../lib/testUtils');
const { handler } = require('../../lambdas/providerSecretsMigration');

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

test.after.always(async () => {
  await S3.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('Empty, Plaintext, KMS-encrypted, and S3KeyPairProvider-encrypted credentials are all updated properly', async (t) => {
  const { providerModel } = t.context;

  // Create and store the provider without credentials
  const uncredentialedProvider = fakeProviderFactory({
    protocol: 'ftp',
    encrypted: false
  });

  delete uncredentialedProvider.username;
  delete uncredentialedProvider.password;

  await dynamodbDocClient().put({
    TableName: process.env.ProvidersTable,
    Item: { ...uncredentialedProvider, createdAt: Date.now() }
  }).promise();

  // Create and store the plaintext provider
  const ptProvider = fakeProviderFactory({
    protocol: 'ftp',
    encrypted: false,
    username: 'my-username',
    password: 'my-password'
  });

  await dynamodbDocClient().put({
    TableName: process.env.ProvidersTable,
    Item: { ...ptProvider, createdAt: Date.now() }
  }).promise();

  // Create and store the KMS provider
  const kmsProvider = fakeProviderFactory({
    protocol: 'ftp',
    username: 'my-username',
    password: 'my-password'
  });

  await providerModel.create(kmsProvider);

  // Create and store the S3KeyPairProvider provider
  const username = await S3KeyPairProvider.encrypt('my-username');
  const password = await S3KeyPairProvider.encrypt('my-password');

  const s3EncryptedProvider = fakeProviderFactory({
    protocol: 'ftp',
    encrypted: true,
    username,
    password
  });

  await dynamodbDocClient().put({
    TableName: process.env.ProvidersTable,
    Item: { ...s3EncryptedProvider, createdAt: Date.now() }
  }).promise();

  await handler();

  // Make sure it all worked
  const fetchedUncredentialedProvider = await providerModel.get({ id: uncredentialedProvider.id });
  t.is(fetchedUncredentialedProvider.encrypted, false);
  t.is(await fetchedUncredentialedProvider.username, undefined);
  t.is(await fetchedUncredentialedProvider.password, undefined);

  const fetchedPtProvider = await providerModel.get({ id: ptProvider.id });
  t.is(fetchedPtProvider.encrypted, true);
  t.is(await KMS.decryptBase64String(fetchedPtProvider.username), 'my-username');
  t.is(await KMS.decryptBase64String(fetchedPtProvider.password), 'my-password');

  const fetchedKmsProvider = await providerModel.get({ id: kmsProvider.id });
  t.is(fetchedKmsProvider.encrypted, true);
  t.is(await KMS.decryptBase64String(fetchedKmsProvider.username), 'my-username');
  t.is(await KMS.decryptBase64String(fetchedKmsProvider.password), 'my-password');

  const fetchedS3Provider = await providerModel.get({ id: s3EncryptedProvider.id });
  t.is(fetchedS3Provider.encrypted, true);
  t.is(await KMS.decryptBase64String(fetchedS3Provider.username), 'my-username');
  t.is(await KMS.decryptBase64String(fetchedS3Provider.password), 'my-password');
});

test.serial('A provider with an un-decryptable encrypted password causes an exception to be thrown', async (t) => {
  const provider = fakeProviderFactory({
    protocol: 'ftp',
    encrypted: true,
    username: 'blah',
    password: 'blah'
  });

  await dynamodbDocClient().put({
    TableName: process.env.ProvidersTable,
    Item: { ...provider, createdAt: Date.now() }
  }).promise();

  await t.throwsAsync(handler());
});
