'use strict';

const forge = require('node-forge');

/**
 * Generates public/private key pairs
 *
 * @function generateKeyPair
 * @returns {Object} a forge pki object
 */
function generateKeyPair() {
  const rsa = forge.pki.rsa;
  console.log('Generating keys. It might take a few seconds!');
  return rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
}

/**
 * Generates private/public keys and Upload them to a given bucket
 *
 * @param {string} bucket - the bucket to upload the keys to
 * @param {string} key - the key (folder) to use for the uploaded files
 * @param {Object} s3 - an instance of the AWS S3 class
 * @returns {Promise} resolves `undefined` when upload is complete
 */
async function uploadKeyPair(bucket, key, s3) {
  const pki = forge.pki;
  const keyPair = generateKeyPair();
  console.log('Keys Generated');

  // upload the private key
  const privateKey = pki.privateKeyToPem(keyPair.privateKey);
  const params1 = {
    Bucket: bucket,
    Key: `${key}/private.pem`,
    ACL: 'private',
    Body: privateKey
  };

  // upload the public key
  const publicKey = pki.publicKeyToPem(keyPair.publicKey);
  const params2 = {
    Bucket: bucket,
    Key: `${key}/public.pub`,
    ACL: 'private',
    Body: publicKey
  };

  await s3.putObject(params1).promise();
  await s3.putObject(params2).promise();

  console.log('keys uploaded to S3');
}

/**
 * Checks if the private/public key exists. If not, it
 * generates and uploads them
 *
 * @param {string} stack - name of the stack
 * @param {string} bucket - the bucket to upload the keys to
 * @param {Object} s3 - an instance of AWS S3 class
 * @returns {Promise} resolves `undefined` when complete
 */
async function crypto(stack, bucket, s3) {
  const key = `${stack}/crypto`;

  // check if files are generated
  try {
    await s3.headObject({
      Key: `${key}/public.pub`,
      Bucket: bucket
    }).promise();

    await s3.headObject({
      Key: `${key}/private.pem`,
      Bucket: bucket
    }).promise();
  } catch (e) {
    await uploadKeyPair(bucket, key, s3);
  }
}

module.exports = {
  generateKeyPair,
  uploadKeyPair,
  crypto
};
