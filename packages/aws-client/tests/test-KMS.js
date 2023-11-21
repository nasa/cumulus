'use strict';

const test = require('ava');
const { CreateKeyCommand, DescribeKeyCommand, DecryptCommand, EncryptCommand } = require('@aws-sdk/client-kms');
const { kms } = require('../services');
const KMS = require('../KMS');

test.before(async (t) => {
  const createKeyResponse = await kms().send(new CreateKeyCommand({}));
  t.context.KeyId = createKeyResponse.KeyMetadata.KeyId;
});

test('createKey() creates a key', async (t) => {
  const createKeyResponse = await KMS.createKey();

  await t.notThrowsAsync(
    kms().send(new DescribeKeyCommand({ KeyId: createKeyResponse.KeyMetadata.KeyId }))
  );
});

test('encrypt() properly encrypts a value', async (t) => {
  const ciphertext = await KMS.encrypt(t.context.KeyId, 'asdf');

  const plaintext = await kms().send(new DecryptCommand({
    CiphertextBlob: Buffer.from(ciphertext, 'base64'),
  })).then(({ Plaintext }) => Plaintext.toString());

  t.is(plaintext, 'asdf');
});

test('decryptBase64String() properly decrypts a value', async (t) => {
  const { KeyId } = t.context;
  const ciphertext = await kms().send(new EncryptCommand({ KeyId, Plaintext: 'asdf' }))
    .then(({ CiphertextBlob }) => CiphertextBlob.toString('base64'));

  const plaintext = await KMS.decryptBase64String(ciphertext);
  t.is(plaintext, 'asdf');
});

test('decryptBase64String() throws an error if value is not encrypted', async (t) => {
  await t.throwsAsync(() => KMS.decryptBase64String('notencrypted'),
    { code: 'InvalidCiphertextException' });
});
