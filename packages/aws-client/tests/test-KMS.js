'use strict';

const test = require('ava');
const { kms } = require('../services');
const KMS = require('../KMS');

test.before(async (t) => {
  const createKeyResponse = await kms().createKey({}).promise();
  t.context.KeyId = createKeyResponse.KeyMetadata.KeyId;
});

test('createKey() creates a key', async (t) => {
  const createKeyResponse = await KMS.createKey();

  await t.notThrowsAsync(
    kms().describeKey({
      KeyId: createKeyResponse.KeyMetadata.KeyId
    }).promise()
  );
});

test('encrypt() properly encrypts a value', async (t) => {
  const ciphertext = await KMS.encrypt(t.context.KeyId, 'asdf');

  const plaintext = await kms().decrypt({
    CiphertextBlob: Buffer.from(ciphertext, 'base64')
  }).promise()
    .then(({ Plaintext }) => Plaintext.toString());

  t.is(plaintext, 'asdf');
});

test('decryptBase64String() properly decrypts a value', async (t) => {
  const { KeyId } = t.context;

  const ciphertext = await kms().encrypt({ KeyId, Plaintext: 'asdf' }).promise()
    .then(({ CiphertextBlob }) => CiphertextBlob.toString('base64'));

  const plaintext = await KMS.decryptBase64String(ciphertext);
  t.is(plaintext, 'asdf');
});
