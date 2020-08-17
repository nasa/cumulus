/**
 * Provides encryption and decryption methods with a consistent API but
 * differing mechanisms for dealing with encryption keys.
 */

import noop from 'lodash/noop';
import AWS from 'aws-sdk';
import forge from 'node-forge';

import { deprecate } from './util';
import { inTestMode } from './test-utils';

export { KMS } from './kms';

const getLocalStackHost = () => {
  if (process.env.LOCAL_S3_HOST) {
    return process.env.LOCAL_S3_HOST;
  }

  if (!process.env.LOCALSTACK_HOST) {
    throw new Error('The LOCALSTACK_HOST environment variable is not set.');
  }

  return process.env.LOCALSTACK_HOST;
};

const buildS3Client = () => {
  const region = process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
  AWS.config.update({ region });

  // Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
  // @ts-expect-error
  AWS.util.update(AWS.S3.prototype, { addExpect100Continue: noop });
  AWS.config.setPromisesDependency(Promise);

  const options: AWS.S3.Types.ClientConfiguration = {
    apiVersion: '2006-03-01',
  };

  if (inTestMode()) {
    options.accessKeyId = 'my-access-key-id';
    options.endpoint = `http://${getLocalStackHost()}:4572`;
    options.region = 'us-east-1';
    options.s3ForcePathStyle = true;
    options.secretAccessKey = 'my-secret-access-key';
  }

  return new AWS.S3(options);
};

const getTextObject = async (bucket: string, key: string) => {
  const s3 = buildS3Client();

  const { Body } = await s3.getObject({
    Bucket: bucket,
    Key: key,
  }).promise();

  return Body ? Body.toString() : undefined;
};

const retrieveKey = async (
  keyId: string,
  bucket = process.env.system_bucket,
  stack = process.env.stackName
) => {
  if (!bucket) {
    throw new Error('Unable to determine bucket to retrieve key from');
  }

  if (!stack) {
    throw new Error('Unable to determine stack to retrieve key for');
  }

  const key = `${stack}/crypto/${keyId}`;

  try {
    return await getTextObject(bucket, key);
  } catch (error) {
    throw new Error(`Failed to retrieve S3KeyPair key from s3://${bucket}/${key}: ${error.message}`);
  }
};

/**
 * Provides encryption and decryption methods using a keypair stored in S3
 */
export class S3KeyPairProvider {
  /**
   * Encrypt the given string using the given public key stored in the system_bucket.
   *
   * @param {string} str - The string to encrypt
   * @param {string} [keyId] - The name of the public key to use for encryption
   * @param {string} [bucket] - the optional bucket name. if not provided will
   *                          use env variable "system_bucket"
   * @param {stack} [stack] - the optional stack name. if not provided will
   *                        use env variable "stackName"
   * @returns {Promise.<string>} the encrypted string
   */
  static async encrypt(
    str: string,
    keyId = 'public.pub',
    bucket?: string,
    stack?: string
  ) {
    deprecate('@cumulus/common/key-pair-provider', '1.17.0', '@cumulus/aws-client/KMS.encrypt');

    // Download the publickey
    const pki = forge.pki;
    const pub = await retrieveKey(keyId, bucket, stack);

    if (!pub) {
      throw new Error('Unable to retrieve public key');
    }

    const publicKey = pki.publicKeyFromPem(pub);
    return forge.util.encode64(publicKey.encrypt(str));
  }

  /**
   * Decrypt the given string using a private key stored in S3
   *
   * @param {string} str - The string to decrypt
   * @param {string} [keyId] - The name of the public key to use for decryption
   * @param {string} [bucket] - the optional bucket name. Defaults to the value
   *   of the "system_bucket" environment variable
   * @param {string} [stack] - the optional stack name. Defaults to the value of
   *   the "stackName" environment variable
   * @returns {Promise.<string>} the decrypted string
   */
  static async decrypt(
    str: string,
    keyId = 'private.pem',
    bucket?: string,
    stack?: string
  ) {
    deprecate('@cumulus/common/key-pair-provider', '1.17.0', '@cumulus/aws-client/KMS.decryptBase64String');

    const pki = forge.pki;
    const priv = await retrieveKey(keyId, bucket, stack);

    if (!priv) {
      throw new Error('Unable to retrieve private key');
    }

    const decoded = forge.util.decode64(str);
    const privateKey = pki.privateKeyFromPem(priv);
    return privateKey.decrypt(decoded);
  }
}

export { S3KeyPairProvider as DefaultProvider };
