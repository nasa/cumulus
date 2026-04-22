'use strict';

const { s3 } = require('@cumulus/aws-client/services');
const {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const log = require('@cumulus/common/log');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { launchpad, getEnvVar } = require('@cumulus/launchpad-auth');

const bucket = getEnvVar('system_bucket');
const lockFileKey = `${getEnvVar('stackName')}/launchpad-token-lock.json`;
const tokenFileKey = `${getEnvVar('stackName')}/launchpad-token.json`;

/**
 * Create a Launchpad token using passphrase, API, and certificate.
 *
 * @returns {Promise<string>} - Generated Launchpad token
 */
async function generateLaunchpadToken(config = {}) {
  const launchpadPassphraseSecretName =
    config.passphraseSecretName || process.env.launchpad_passphrase_secret_name;

  const passphrase = await getSecretString(launchpadPassphraseSecretName);

  const launchpadConfig = {
    passphrase,
    api: config.api || process.env.launchpad_api,
    certificate: config.certificate || process.env.launchpad_certificate,
  };

  // this should GENERATE A TOKEN, NOT GET AN EXISTING ONE
  // NEED TO FIGURE OUT HOW TO DO THAT
  return await launchpad.getLaunchpadToken(launchpadConfig);
}

/**
 * Check if lock file exists in S3.
 *
 * @returns {Promise<boolean>} - True: if lock file exists
 */
async function lockFileExists() {
  try {
    await s3().send(new HeadObjectCommand({
      Bucket: bucket,
      Key: lockFileKey,
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Remove lock file from S3.
 *
 * @returns {Promise<Object>} - S3 delete response
 */
async function removeLockFile() {
  return await s3().send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: lockFileKey,
  }));
}

/**
 * Create a lock file in S3
 *
 * @returns {Promise<Object>} - S3 put response
 */
async function createLockFile() {
  return await s3().send(new PutObjectCommand({
    Bucket: bucket,
    Key: lockFileKey,
    Body: JSON.stringify({ lockedAt: new Date().toISOString() }),
    ContentType: 'application/json',
    IfNoneMatch: '*', // only create if it doesn't already exist
  }));
}

/**
 * Write the generated token to S3.
 *
 * @param {string} token - the Launchpad token to store
 * @returns {Promise<Object>} - S3 put response
 */
async function putTokenInS3(token) {
  return await s3().send(new PutObjectCommand({
    Bucket: bucket,
    Key: tokenFileKey,
    Body: JSON.stringify({
      token,
      createdAt: new Date().toISOString(),
    }),
    ContentType: 'application/json',
  }));
}

/**
 * Lambda handler that checks for a lock file, generates a Launchpad token if needed,
 * stores it in S3, then re-invokes the calling Lambda.
 *
 * @param {Object} event - Payload with callerEvent and callerFunctionName
 * @returns {Promise<Object>} - Result from the re-invoked Lambda
 */
async function handler(event) {
  const config = event.config || {};
  let createdLock = false;
  try {
    // check if lock file already exists
    const isLocked = await lockFileExists();
    if (!isLocked) {
     // lock file doesn't already exist, so create it and the token + store them
      await createLockFile();
      createdLock = true;
      // here we need to make the distinction between create/get and just get
      // in this if the token should be removed/a new one created and stored
      // might need 2 different functions to do that
      const token = await generateLaunchpadToken(config);
      await putTokenInS3(token);
      return { statusCode: 200, token };
    } else {
      // lock file does exist, so return the token that's already in s3
      // in this we just need to GET the token (no creating or removing just get)
      const token = await generateLaunchpadToken(config);
      // possibly should have unique status/message compared to the if there is no lock
      return { statusCode: 200, token };
    }
  } catch (error) {
    log.error('Error during Launchpad token generation:', error);
    throw error;
  } finally {
    // only remove the lock in case this invocation created it
    if (createdLock) {
      await removeLockFile();
    }
  }
}

module.exports = {
  handler,
  generateLaunchpadToken,
  lockFileExists,
  createLockFile,
  putTokenInS3,
  removeLockFile,
};
