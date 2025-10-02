'use strict';

import { getLaunchpadToken } from '@cumulus/launchpad-auth';
import { LzardsApiGetRequestParameters } from './types';
import { GetAuthTokenError } from './errors';

const { getRequiredEnvVar } = require('@cumulus/common/env');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const got = require('got');
const Logger = require('@cumulus/logger');
const isEmpty = require('lodash/isEmpty');

const log = new Logger({ sender: 'api/lib/lzards' });

/**
 * Retrieve Launchpad Auth Token
 *
 * @param {Function} getSecretStringFunction - function used to retrieve a secret from AWS
 * @param {Function} getLaunchpadTokenFunction - function used to retrieve cached Launchpad token
 * @returns {Promise<string>} - resolves to a Launchpad Token string
 */
export async function getAuthToken(
  getSecretStringFunction = getSecretString,
  getLaunchpadTokenFunction = getLaunchpadToken
) {
  const api = getRequiredEnvVar('launchpad_api');
  const passphrase = await getSecretStringFunction(getRequiredEnvVar('lzards_launchpad_passphrase_secret_name'));
  if (!passphrase) {
    throw new GetAuthTokenError('The value stored in "launchpad_passphrase_secret_name" must be defined');
  }
  const certificate = getRequiredEnvVar('lzards_launchpad_certificate');
  const token = await getLaunchpadTokenFunction({
    api, passphrase, certificate,
  });
  return token;
}

/**
 * Submit query to LZARDS
 *
 * @param {Object}   params
 * @param {Object}   params.searchParams -  object containing search parameters to pass to lzards
 * @param {Function} params.getAuthTokenFunction - function used to get a launchpad auth token
 * @returns {Promise<Object>} - resolves to the LZARDS return
 */
export async function submitQueryToLzards(
  {
    searchParams,
    getAuthTokenFunction = getAuthToken,
  }: LzardsApiGetRequestParameters
) {
  const lzardsApiUri = getRequiredEnvVar('lzards_api');
  const provider = getRequiredEnvVar('lzards_provider');

  if (!searchParams || isEmpty(searchParams)) {
    const errMsg = 'The required searchParams is not provided or empty';
    log.error(errMsg);
    throw new Error(errMsg);
  }

  const authToken = await getAuthTokenFunction();

  try {
    return await got.get(
      lzardsApiUri,
      {
        searchParams: { ...searchParams, provider },
        responseType: 'json',
        throwHttpErrors: false,
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );
  } catch (error) {
    log.error('submitQueryToLzards encountered error:', error);
    throw error;
  }
}
