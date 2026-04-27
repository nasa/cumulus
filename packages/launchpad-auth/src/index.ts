/**
 * Utility functions for generating and validating Launchpad tokens
 *
 * @module launchpad-auth
 */

import pick from 'lodash/pick';
import { Readable } from 'stream';

import { s3 } from '@cumulus/aws-client/services';
import {
  getObject,
  s3Join,
  s3ObjectExists,
  s3PutObject,
  getObjectStreamContents,
} from '@cumulus/aws-client/S3';
import Logger from '@cumulus/logger';

import {
  LaunchpadTokenParams,
  TokenObject,
  ValidateTokenResult,
} from './types';

import LaunchpadToken from './LaunchpadToken';
import { getEnvVar } from './utils';

const log = new Logger({ sender: '@cumulus/launchpad-auth' });

const {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');

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

  return await getLaunchpadToken(config);
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
  const token = await getLaunchpadToken(config);
  return { statusCode: 200, token };
}

/**
 * Lambda handler that checks for a lock file, generates a Launchpad token if needed,
 * stores it in S3, then re-invokes the calling Lambda.
 *
 * @param {Object} event - Payload with callerEvent and callerFunctionName
 * @returns {Promise<Object>} - Result from the re-invoked Lambda
 */
async function getValidLaunchpadToken(event) {
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























/**
 * Get S3 location of the Launchpad token
 *
 * @returns {Promise<Object<string, string>>} - S3 Bucket and Key where Launchpad token is stored
 *
 * @private
 */
function launchpadTokenBucketKey(): {
  Bucket: string,
  Key: string
} {
  const bucket = getEnvVar('system_bucket');
  const stackName = getEnvVar('stackName');
  return {
    Bucket: bucket,
    Key: s3Join(stackName, 'launchpad/token.json'),
  };
}

/**
 * Retrieve Launchpad token from S3
 *
 * @returns {Promise<string|undefined>}
 *   the Launchpad token, undefined if token doesn't exist or invalid
 *
 * @async
 * @private
 */
async function getValidLaunchpadTokenFromS3(): Promise<string | undefined> {
  const s3location = launchpadTokenBucketKey();
  const keyExists = await s3ObjectExists(s3location);

  let token;
  if (keyExists) {
    const s3object = await getObject(s3(), s3location);
    if (s3object.Body && s3object.Body instanceof Readable) {
      const launchpadToken = <TokenObject>JSON.parse(
        await getObjectStreamContents(s3object.Body)
      );
      const now = Date.now();
      const tokenExpirationInMs = (
        launchpadToken.session_maxtimeout + launchpadToken.session_starttime
      ) * 1000;

      // check if token is still valid
      if (now < tokenExpirationInMs) {
        token = launchpadToken.sm_token;
      }
    }
  }

  return token;
}

/**
 * Get a Launchpad token
 *
 * @param {Object} params - the configuration parameters for creating LaunchpadToken object
 * @param {string} params.api - the Launchpad token service api endpoint
 * @param {string} params.passphrase - the passphrase of the Launchpad PKI certificate
 * @param {string} params.certificate - the name of the Launchpad PKI pfx certificate
 *
 * @returns {Promise<string>} - the Launchpad token
 *
 * @async
 * @alias module:launchpad-auth
 */
export async function getLaunchpadToken(params: LaunchpadTokenParams): Promise<string> {
  let token = await getValidLaunchpadTokenFromS3();

  if (!token) {
    log.debug('getLaunchpadToken requesting launchpad token');
    const launchpad = new LaunchpadToken(params);
    const tokenResponse = await launchpad.requestToken();
    // add session_starttime to token object, assume token is generated 5 min ago
    const tokenObject: TokenObject = {
      ...tokenResponse,
      session_starttime: (Date.now() / 1000) - (5 * 60),
    };

    // check if the token in s3 has been updated before updating it with the new token
    token = await getValidLaunchpadTokenFromS3();
    if (!token) {
      log.debug('getLaunchpadToken updating launchpad token in s3');
      const s3location = launchpadTokenBucketKey();
      await s3PutObject({
        Bucket: s3location.Bucket,
        Key: s3location.Key,
        Body: JSON.stringify(tokenObject),
      });

      token = tokenObject.sm_token;
    }
  }

  return token;
}

/**
 * Validate a Launchpad token
 *
 * @param {Object} params - the configuration parameters for creating LaunchpadToken object
 * @param {string} params.api - the Launchpad token service api endpoint
 * @param {string} params.passphrase - the passphrase of the Launchpad PKI certificate
 * @param {string} params.certificate - the name of the Launchpad PKI pfx certificate
 * @param {string} token - the token to be validated
 * @param {string} [userGroup] - the cumulus user group that a valid user should belong to
 *
 * @returns {Promise<ValidateTokenResult>} - the validate result object with
 * { status: 'success or failed', message: 'reason for failure',
 * session_maxtimeout: number second, session_starttime: number millisecond,
 * owner_auid: string}
 *
 * @async
 * @alias module:launchpad-auth
 */
async function validateLaunchpadToken(
  params: LaunchpadTokenParams,
  token: string,
  userGroup?: string
): Promise<ValidateTokenResult> {
  log.debug('validateLaunchpadToken validating launchpad token');
  const launchpad = new LaunchpadToken(params);
  const response = await launchpad.validateToken(token);
  let result: ValidateTokenResult = { status: response.status };

  if (response.status === 'success') {
    // check if user is in the given group
    if (userGroup && userGroup.toUpperCase() !== 'N/A'
       && response.owner_groups.filter((group: string) => group.includes(userGroup)).length === 0) {
      result.status = 'failed';
      result.message = 'User not authorized';
    }
  } else {
    result.message = 'Invalid access token';
  }

  if (result.status === 'success') {
    const picked = pick(response, ['session_maxtimeout', 'session_starttime', 'owner_auid']);
    result = Object.assign(result, picked);
  }

  return result;
}

module.exports = {
  getLaunchpadToken,
  validateLaunchpadToken,
};
