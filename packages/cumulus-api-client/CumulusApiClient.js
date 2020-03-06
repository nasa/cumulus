'use strict';

const got = require('got');
const normalizeUrl = require('normalize-url');
const { decryptBase64String, encrypt } = require('@cumulus/aws-client/KMS');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { decode } = require('jsonwebtoken');
const Logger = require('@cumulus/logger');
const CumulusApiClientError = require('./CumulusApiClientError');
const CumulusAuthTokenError = require('./CumulusAuthTokenError');


class CumulusApiClient {
  constructor(config = {}, requiredKeys = ['kmsId', 'baseUrl', 'authTokenTable', 'tokenSecretName']) {
    if (!requiredKeys.every((key) => Object.keys(config).includes(key))) {
      throw new CumulusApiClientError(
        `Invalid config ${JSON.stringify(config)} - required keys are ${JSON.stringify(requiredKeys)}`
      );
    }
    const defaultConfig = {
      tokenExpireBuffer: 5 * 60,
      tokenSecretName: 'cachedBearerTokenDefault'
    };
    this.config = { ...defaultConfig, ...config };
    this.config.baseUrl = normalizeUrl(config.baseUrl);
    this.Error = CumulusApiClientError;
    this.logger = new Logger({});
    this.cacheInitialized = false;
  }

  /**
   * Do an HTTP GET request to a Cumulus API endpoint with optional token authentication retries
   * @memberof CumulusApiClient
   * @param {string} requestPath - Cumulus API endpoint to call
   * @param {integer} authRetry - number of times to retry on auth expiry failure.
   *                              Should be set to 1 for launchpad oauth to account
   *                              for Oauth expiration failures
   * @returns {Promise<Object>} - Returns response object from got.get
   */
  async get(requestPath, authRetry = 1) {
    const headers = { Authorization: `Bearer ${await this.getCacheAuthToken()}` };
    try {
      const response = await got.get(`${this.config.baseUrl}/${requestPath}`, { headers });
      return response;
    } catch (error) {
      if (authRetry > 0 && error.message === 'Access token has expired') {
        this.logger.info('API Client access token expired on get, generating new token');
        await this.getCacheAuthToken();
        return this.get(requestPath, authRetry - 1);
      }
      throw error;
    }
  }

  async createNewAuthToken() {
    throw new CumulusApiClientError('createNewAuthToken not implemented in the base class');
  }

  /**
   * @memberof CumulusApiClient
   * gets an auth token back from the dynamo cache table
   *
   * @returns {Promise<Object>} - decrypted auth token from the auth token table
   *
   * @throws {CumulusAuthTokenError} - throws on new error conditions
   */
  async _getAuthTokenRecord() {
    const params = {
      TableName: this.config.authTokenTable,
      Key: {
        tokenAlias: this.config.tokenSecretName
      }
    };
    const tokenResponse = await dynamodbDocClient().get(params).promise();
    if (!tokenResponse.Item) {
      throw new CumulusAuthTokenError(`No bearer token with alias '${this.config.tokenSecretName}'
      found in ${this.config.authTokenTable}`);
    }
    try {
      const key = await decryptBase64String(tokenResponse.Item.bearerToken);
      return key;
    } catch (error) {
      if (error.name === 'AccessDeniedException') {
        throw new CumulusAuthTokenError(`Existing cached token invalid for ${this.config.tokenSecretName}`);
      }
      throw error;
    }
  }

  /**
   * Updates the auth token table record
   * @memberof CumulusApiClient
   * @param {string} token - Updates the row at config.tokenSecretName with
   *                         a kms encrypted token record
   * @returns {Promise<Object>} - dynamodbDocClient response
   */
  async _updateAuthTokenRecord(token) {
    const encryptedToken = await encrypt(this.config.kmsId, token);
    const params = {
      TableName: this.config.authTokenTable,
      Key: {
        tokenAlias: this.config.tokenSecretName
      },
      UpdateExpression: 'set bearerToken = :t',
      ExpressionAttributeValues: {
        ':t': encryptedToken
      }
    };
    return dynamodbDocClient().update(params).promise();
  }

  /**
   * Helper function to check how much time the JWT has left before expiration
   * @memberof CumulusApiClient
   * @param {string} token - bearer JWT
   *
   * @returns {number} - the number of seconds left before the token expires
   */
  async _getTokenTimeLeft(token) {
    return (((decode(token).exp) - (Date.now() / 1000)));
  }

  /**
   * Validates if a JWT is close to expiration, and throws an error if so
   * @memberof CumulusApiClient
   * @param {string} token
   *
   * @throws (CumulusAuthTokenError)
   */
  async _validateTokenExpiry(token) {
    const tokenSecondsRemaining = await this._getTokenTimeLeft(token);
    if (tokenSecondsRemaining <= 0) {
      throw new CumulusAuthTokenError('Token expired, obtraining new token');
    }
    if (tokenSecondsRemaining <= this.config.tokenExpireBuffer && tokenSecondsRemaining > 0) {
      throw new CumulusAuthTokenError('Token nearing experation, obtraining new token');
    }
  }

  /**
   * Calls create token, then updates the cache with the new record
   * @memberof CumulusApiClient
   *
   * @throws {CumulusAuthTokenError} - throws on any error
   * @returns {string} - returns active valid bearer token
   */
  async _createAndUpdateNewAuthToken() {
    try {
      const updateToken = await this.createNewAuthToken();
      await this._updateAuthTokenRecord(
        updateToken
      );
      return updateToken;
    } catch (error) {
      throw new CumulusAuthTokenError(error);
    }
  }

  /**
   * Updates the cached bearer token and sets cacheInitialized to true
   * @memberof CumulusApiClient
   *
   * @returns {string} -
   */
  async _initializeCache() {
    this.logger.info('Creating new token on class creation');
    const token = await this._createAndUpdateNewAuthToken();
    this.cacheInitialized = true;
    return token;
  }

  /**
   * Gets a token using the CumulusApiClient caching scheme:
   *  1) If the class hasn't been initialized, cretes a new token *else*
   *     attempts to get a valid token from the cache table.
   *  2) If it is successful, check (if possible) if the token is about to expire
   *  3) If the token does not exist, or is about to expire, generate a new token
   *     and store it inthe cache
   * @memberof CumulusApiClient
   *
   * @returns {string} - returns active valid bearer token
   */
  async getCacheAuthToken() {
    try {
      let token;
      if (this.cacheInitialized) {
        token = await this._getAuthTokenRecord();
      } else {
        token = await this._initializeCache();
      }
      await this._validateTokenExpiry(token);
      return token;
    } catch (error) {
      if (error.name === 'CumulusAuthTokenError') {
        this.logger.info('GetCacheAuthToken failed retrieval validation, generating new token');
        // We're not refreshing as /refresh invalidates what could be
        // an active key
        const updateToken = await this._createAndUpdateNewAuthToken();
        return updateToken;
      }
      throw error;
    }
  }
}

module.exports = CumulusApiClient;
