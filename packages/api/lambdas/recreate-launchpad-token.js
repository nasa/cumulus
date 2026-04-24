'use strict';

const { s3 } = require('@cumulus/aws-client/services');
const {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const log = require('@cumulus/common/log');
const { launchpad, getEnvVar } = require('@cumulus/launchpad-auth');

const bucket = getEnvVar('system_bucket');
const lockFileKey = `${getEnvVar('stackName')}/launchpad-token-lock.json`;
const tokenFileKey = `${getEnvVar('stackName')}/launchpad-token.json`;
const LOCK_WAIT_TIMEOUT_MS = Number(process.env.LAUNCHPAD_LOCK_WAIT_MS) || 60000;
const LOCK_INITIAL_DELAY_MS = 250;
const LOCK_MAX_DELAY_MS = 5000;

/**
 * Create a Launchpad token using passphrase, API, and certificate.
 *
 * @returns {Promise<string>} - generated Launchpad token
 */
async function generateLaunchpadToken(config = {}) {
  // delete old token and regen a new one
  try {
    await s3().send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: tokenFileKey,
    }));
  } catch (error) {
    if (error.name !== 'NoSuchKey' && error.name !== 'NotFound') {
      throw error;
    }
  }

  return await launchpad.getLaunchpadToken(config);
}

/**
 * Poll S3 until the launchpad token lock file is NotFound or times out.
 *
 */
/* eslint-disable no-await-in-loop */
async function waitForLockFileRelease() {
  const startTime = Date.now();
  let delay = LOCK_INITIAL_DELAY_MS;

  while (Date.now() - startTime < LOCK_WAIT_TIMEOUT_MS) {
    try {
      await s3().send(new HeadObjectCommand({
        Bucket: bucket,
        Key: lockFileKey,
      }));
    } catch (error) {
      if (error.name === 'NotFound') {
        return;
      }
      throw error;
    }

    // jitter + retry
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    const sleepMs = Math.max(50, delay + jitter);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    delay = Math.min(delay * 2, LOCK_MAX_DELAY_MS);
  }

  throw new Error(
    `Timed out after ${LOCK_WAIT_TIMEOUT_MS}ms waiting for launchpad lock file to be released`
  );
}
/* eslint-enable no-await-in-loop */

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
 * Wait for the lock file to release and read/return the created token
 *
 * @returns {Promise<Object>} - S3 put response
 */
async function waitAndReadToken(config = {}) {
  await waitForLockFileRelease();
  const token = await launchpad.getLaunchpadToken(config);
  return { statusCode: 200, token };
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
  const launchpadConfig = {
    passphrase: config.passphrase,
    api: config.api,
    certificate: config.certificate,
  };

  let createdLock = false;
  try {
    const isLocked = await lockFileExists();

    if (isLocked) {
      // Someone else is creating the token, wait for lock file release and just use that one
      return await waitAndReadToken(launchpadConfig);
    }
    // lock is not there, so we can create it here and try to make the token
    try {
      await createLockFile();
      createdLock = true;
    } catch (err) {
      if (err.name !== 'PreconditionFailed') {
        throw err;
      }
      // Lost the token-creating race, so we wait and read like before
      return await waitAndReadToken(launchpadConfig);
    }

    const token = await generateLaunchpadToken(launchpadConfig);
    return { statusCode: 200, token };
  } catch (error) {
    log.error('Error during Launchpad token generation:', error);
    throw error;
  } finally {
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
  removeLockFile,
  waitForLockFileRelease,
};
