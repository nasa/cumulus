'use strict';

const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const LaunchpadApiClient = require('./LaunchpadApiClient');
const EdlApiClient = require('./EdlApiClient');
const CumulusApiClientError = require('./CumulusApiClientError');


/**
 * Convienance class factory for CumulusApiClient subclasses
 * @param {string} [tokenCacheKey='defaulttokenCacheKey'] - AuthTokenTable key to use for
 *                                                          bearer token cache
 * @param {string} [provider=process.env.oauth_provider]  - auth provider ('earthdata' or
 *                                                          'launchpad')
 * @param {string} config                      - subclass configuration object:
 * @param {string} config.baseUrl              - Cumulus API baseUrl
 * @param {string} config.username             - EDL username to use for auth
 * @param {string} config.password             - EDL password to use for auth
 * @param {string} config.kmsId                - ID of the AWS KMS key used for
 *                                               encryption/decryption
 * @param {string} config.tokenSecretName      - 'Cached bearer token name alias to utilize
 * @param {string} config.authTokenTable       - Dynamodb table to use for token caching
 * @param {string} config.launchpadPassphrase  - Launchpad passphrase to use for auth
 * @param {string} config.launchpadApi         - URL of launchpad api to use for authorization
 * @param {string} config.launchpadCertificate - key of certificate object stores in the
 *                                               internal crypto bucket
 * @param {string} config.userGroup            - User group for use with launchpad oauth
 *                                               cryption/decryption
 * @returns {Object} - Returns a new EdlApiClient or LaunchpadApiClient class instance
 */
const cumulusApiClientFactory = async (tokenCacheKey = 'defaulttokenCacheKey',
  provider = process.env.oauth_provider, config) => {
  // default configuration object
  const defaultConfigurations = {
    kmsId: process.env.auth_kms_key_id,
    baseUrl: process.env.internal_archive_api_uri,
    userGroup: process.env.oauth_user_group,
    launchpadPassphrase: await getSecretString(
      process.env.launchpadPassphraseSecretName
    ),
    launchpadApi: process.env.launchpad_api,
    launchpadCertificate: process.env.launchpad_certificate,
    tokenSecretName: tokenCacheKey,
    authTokenTable: process.env.AuthTokensTable,
    username: process.env.urs_id,
    password: await getSecretString(
      process.env.urs_password_secret_name
    )
  };
  const authConfig = config ? { ...defaultConfigurations, ...config } : defaultConfigurations;

  if (provider === 'earthdata') {
    return new EdlApiClient(authConfig);
  }
  if (provider === 'launchpad') {
    return new LaunchpadApiClient(authConfig);
  }
  throw new CumulusApiClientError(`${provider} is not supported as an auth provider in this module`);
};

module.exports = { cumulusApiClientFactory };
