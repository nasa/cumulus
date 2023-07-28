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
    // add session_starttime to token object, assume token is generated 60s ago
    const tokenObject: TokenObject = {
      ...tokenResponse,
      session_starttime: (Date.now() / 1000) - (5*60),
    };

    const s3location = launchpadTokenBucketKey();
    await s3PutObject({
      Bucket: s3location.Bucket,
      Key: s3location.Key,
      Body: JSON.stringify(tokenObject),
    });

    token = tokenObject.sm_token;
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
