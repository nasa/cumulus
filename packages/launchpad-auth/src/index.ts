/**
 * Utility functions for generating, refreshing, and validating Launchpad tokens
 *
 * @module launchpad-auth
 */

import pick from 'lodash/pick';
import { Readable } from 'stream';
import pRetry from 'p-retry';

import { s3 } from '@cumulus/aws-client/services';
import {
  deleteS3Object,
  getObject,
  headObject,
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

const getSystemBucket = () => getEnvVar('system_bucket');
const getLockFileKey = () => `${getEnvVar('stackName')}/launchpad/token-lock.json`;
const getTokenFileKey = () => `${getEnvVar('stackName')}/launchpad/token.json`;
const LOCK_TTL_MS = 15 * 60 * 1000; // 15 min: max runtime of lambda

/**
 * Remove the launchpad token lock file from S3.
 *
 * @returns - S3 delete response
 */
async function removeLockFile(): Promise<Object | undefined> {
  let response;
  await pRetry(
    async () => {
      try {
        response = await deleteS3Object(getSystemBucket(), getLockFileKey());
      } catch (error) {
        if (error instanceof Error && ['NoSuchKey', 'NotFound'].includes(error.name)) {
          return;
        }
        throw error;
      }
    },
    { retries: 5 }
  );
  return response;
}

/**
 * Poll S3 until the launchpad token lock file is NotFound or times out with exponential backoff
 *
 * @param retries - number of poll attempts before timing out, defaults to 5
 *
 */
async function waitForLockFileRelease(
  retries: number = 5
) {
  await pRetry(
    async () => {
      let head;
      try {
        head = await headObject(getSystemBucket(), getLockFileKey());
      } catch (error) {
        if (error instanceof Error && ['NoSuchKey', 'NotFound'].includes(error.name)) {
          return;
        }
        throw new pRetry.AbortError(error);
      }
      if (head.LastModified && (Date.now() - head.LastModified.getTime() > LOCK_TTL_MS)) {
        await removeLockFile();
        return;
      }

      throw new Error('Timed out waiting for launchpad token lock file removal');
    },
    {
      retries,
      maxTimeout: 5000,
      onFailedAttempt: (error) => {
        log.debug(
          `Waiting for launchpad token lock file release: attempt ${error.attemptNumber} failed, ${error.retriesLeft} retries left`, error
        );
      },
    }
  );
}

/**
 * Create a launchpad token lock file in S3, to let other processes know that a new launchpad token
 * is actively being created by another process
 *
 * @returns - S3 put response
 */
async function createLockFile(): Promise<Object> {
  return await s3PutObject({
    Bucket: getSystemBucket(),
    Key: getLockFileKey(),
    IfNoneMatch: '*',
  });
}

/**
 * Check whether the launchpad token lock file in S3 is stale from a previous process
 * that failed to remove it.
 *
 * @returns - boolean for if the lock file is stale
 */
async function isLockStale(): Promise<boolean> {
  try {
    const head = await headObject(getSystemBucket(), getLockFileKey());
    if (!head.LastModified) {
      return false;
    }
    const ageMs = Date.now() - head.LastModified.getTime();
    return ageMs > LOCK_TTL_MS;
  } catch (error) {
    if (error instanceof Error && ['NoSuchKey', 'NotFound'].includes(error.name)) {
      return false;
    }
    throw error;
  }
}

/**
 * Get S3 location of the Launchpad token
 *
 * @returns- S3 Bucket and Key where Launchpad token is stored
 *
 * @private
 */
function launchpadTokenBucketKey(): {
  Bucket: string,
  Key: string
} {
  const stackName = getEnvVar('stackName');
  return {
    Bucket: getSystemBucket(),
    Key: s3Join(stackName, 'launchpad/token.json'),
  };
}

/**
 * Retrieve Launchpad token from S3
 *
 * @returns - the Launchpad token, undefined if token doesn't exist or invalid
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
 * Get a Launchpad token. There may be a lock file if the token is being recreated by
 * a process due to a launchpad 401 auth error, so this function will check if there is one
 * and wait until it's removed by the process creating the new token, and then will get the
 * newly made valid token.
 *
 * @param params - the configuration parameters for creating LaunchpadToken object
 * @param params.api - the Launchpad token service api endpoint
 * @param params.passphrase - the passphrase of the Launchpad PKI certificate
 * @param params.certificate - the name of the Launchpad PKI pfx certificate
 * @param skipLockWait - whether or not to skip waiting for the lock to release
 *
 * @returns - the Launchpad token
 *
 * @async
 * @alias module:launchpad-auth
 */
export async function getLaunchpadToken(
  params: LaunchpadTokenParams,
  skipLockWait: boolean = false
): Promise<string> {
  if (!skipLockWait) {
    await waitForLockFileRelease();
  }
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
 * @param params - the configuration parameters for creating LaunchpadToken object
 * @param params.api - the Launchpad token service api endpoint
 * @param params.passphrase - the passphrase of the Launchpad PKI certificate
 * @param params.certificate - the name of the Launchpad PKI pfx certificate
 * @param token - the token to be validated
 * @param [userGroup] - the cumulus user group that a valid user should belong to
 *
 * @returns - the validate result object with:
 *   status (string) - 'success' or 'failed'
 *   message (string) - reason for failure
 *   session_maxtimeout (number) - seconds
 *   session_starttime (number) - milliseconds
 *   owner_auid (string)
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

/**
 * Remove the existing token and create a new launchpad token using the launchpad config
 *
 * @param params - the configuration parameters for creating LaunchpadToken object
 * @param params.api - the Launchpad token service api endpoint
 * @param params.passphrase - the passphrase of the Launchpad PKI certificate
 * @param params.certificate - the name of the Launchpad PKI pfx certificate
 *
 * @returns - generated Launchpad token
 */
async function generateNewLaunchpadToken(config: LaunchpadTokenParams): Promise<string> {
  try {
    await deleteS3Object(getSystemBucket(), getTokenFileKey());
  } catch (error) {
    if (!(error instanceof Error && ['NoSuchKey', 'NotFound'].includes(error.name))) {
      throw error;
    }
  }

  return await getLaunchpadToken(config, true);
}

/**
 * Attempt to create the launchpad token lock file.
 *
 * @returns - if the lock was successfully acquired or not
 * @throws if S3 returns any error other than PreconditionFailed.
 */
async function acquireLock(): Promise<boolean> {
  try {
    await createLockFile();
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'PreconditionFailed') {
      return false;
    }
    throw error;
  }
}

/**
 * Checks for a lock file, generates or reads a Launchpad token if needed, then returns it
 *
 * @param params - the configuration parameters for creating LaunchpadToken object
 * @param params.api - the Launchpad token service api endpoint
 * @param params.passphrase - the passphrase of the Launchpad PKI certificate
 * @param params.certificate - the name of the Launchpad PKI pfx certificate
 *
 * @returns - valid Launchpad token
 */
export async function getValidLaunchpadToken(params: LaunchpadTokenParams): Promise<string> {
  let createdLock = false;
  try {
    // try to acquire the lock so the token can be created
    createdLock = await acquireLock();
    // some other process created the lock, but we need to check if its stale
    if (!createdLock && await isLockStale()) {
      await removeLockFile();
      createdLock = await acquireLock();
    }
    // lost the token-creating race, so we wait and read like before
    if (!createdLock) {
      return await getLaunchpadToken(params);
    }
    return await generateNewLaunchpadToken(params);
  } finally {
    if (createdLock) {
      try {
        await removeLockFile();
      } catch (error) {
        log.error('Failed to remove launchpad token lock file', error);
      }
    }
  }
}

module.exports = {
  getLaunchpadToken,
  validateLaunchpadToken,
  getValidLaunchpadToken,
  generateNewLaunchpadToken,
  createLockFile,
  removeLockFile,
  waitForLockFileRelease,
};
