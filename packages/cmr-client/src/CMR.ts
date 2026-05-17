import pRetry from 'p-retry';
import get from 'lodash/get';
import got, { Headers } from 'got';
import { CMRInternalError } from '@cumulus/errors';
import { getValidLaunchpadToken } from '@cumulus/launchpad-auth';
import Logger from '@cumulus/logger';
import * as secretsManagerUtils from '@cumulus/aws-client/SecretsManager';
import { getEDLToken } from './EarthdataLogin';
import { CMRResponseBody, CMRErrorResponseBody } from './types';
import { searchConcept } from './searchConcept';
import ingestConcept from './ingestConcept';
import deleteConcept from './deleteConcept';
import getConceptMetadata from './getConcept';
import { getIngestUrl } from './getUrl';
import { UmmMetadata, ummVersion } from './UmmUtils';
const log = new Logger({ sender: 'cmr-client' });
const { getRequiredEnvVar } = require('@cumulus/common/env');

const logDetails: { [key: string]: string } = {
  file: 'cmr-client/CMR.js',
};
/**
 * Returns a valid a CMR token
 *
 * @param {string} username - CMR username
 * @param {string} password - CMR password
 * @returns {Promise.<string | undefined>} the token
 *
 * @private
 */
async function updateToken(
  username: string,
  password: string
): Promise<string | undefined> {
  const edlEnv = getRequiredEnvVar('CMR_ENVIRONMENT');
  if (!edlEnv) throw new Error('CMR_ENVIRONMENT not set');
  return await getEDLToken(username, password, edlEnv);
}

export interface CMRConstructorParams {
  clientId: string,
  password?: string,
  passwordSecretName?: string,
  provider: string,
  token?: string,
  username?: string,
  oauthProvider: string,
  passphrase?: string,
  api?: string,
  certificate?: string,
}

/**
 * A class to simplify requests to the CMR
 *
 * @typicalname cmrClient
 *
 * @example
 * const { CMR } = require('@cumulus/cmr-client');
 *
 * const cmrClient = new CMR({
 *  provider: 'my-provider',
 *  clientId: 'my-clientId',
 *  username: 'my-username',
 *  password: 'my-password'
 * });
 *
 * or
 *
 * const cmrClient = new CMR({
  *  provider: 'my-provider',
  *  clientId: 'my-clientId',
  *  token: 'cmr_or_launchpad_token'
  * });
  * TODO: this should be subclassed or refactored to a functional style
  * due to branch logic/complexity in token vs password/username handling
 */
export class CMR {
  private static instance?: CMR;
  // the variable below is to ensure that if the token is in the process of
  // being refreshed, that other concurrent workers do not attempt to do so as well
  private refreshPromise?: Promise<void>;

  clientId: string;
  provider: string;
  username?: string;
  oauthProvider: string;
  password?: string;
  passwordSecretName?: string;
  token?: string;
  passphrase?: string;
  api?: string;
  certificate?: string;

  /**
   * The constructor for the CMR class
   */
  private constructor(params: CMRConstructorParams) {
    this.clientId = params.clientId;
    this.provider = params.provider;
    this.username = params.username;
    this.password = params.password;
    this.passwordSecretName = params.passwordSecretName;
    this.token = params.token;
    this.oauthProvider = params.oauthProvider;
    this.passphrase = params.passphrase;
    this.api = params.api;
    this.certificate = params.certificate;

    CMR.instance = this;
  }

  /**
   * Creates a new CMR singleton instance of one does not already exist,
   * if one does, returns it
   */
  static getInstance(params: CMRConstructorParams) {
    if (!CMR.instance) {
      CMR.instance = new CMR(params);
    } else {
      log.warn('Returning existing CMR configuration. If you are attempting to use different parameters to create a new instance, please reset the old one using CMR.resetInstance()');
    }
    return CMR.instance;
  }

  /**
  * Get the CMR password, from the AWS secret if set, else return the password
  * @returns {Promise.<string>} - the CMR password
  */
  async getCmrPassword(): Promise<string> {
    if (this.passwordSecretName) {
      const value = await secretsManagerUtils.getSecretString(
        this.passwordSecretName
      );

      if (!value) {
        throw new Error('Unable to retrieve CMR password');
      }

      return value;
    }

    if (!this.password) {
      throw new Error('No CMR password set');
    }

    return this.password;
  }

  /**
   * Resets the CMR singleton instance to undefined, only used for testing with
   * suites that create multiple instances in sequence.
   */
  static resetInstance() {
    CMR.instance = undefined;
  }

  /**
   * The method for getting the token
   *
   * @returns {Promise.<string | undefined>} the token
   */
  async getToken(): Promise<string | undefined> {
    if (this.oauthProvider === 'launchpad') {
      return this.token;
    }
    if (!this.username) {
      throw new Error('Username not specified for non-launchpad CMR client');
    }
    return this.token
      ? this.token
      : updateToken(this.username, await this.getCmrPassword());
  }

  /**
   * Checks if a process calling the cmrClient is in the middle of creating a new launchpad token.
   * This function is called when a 401 launchpad auth error is encountered when using a launchpad
   * token for cmr calls. It calls refreshLaunchpadToken and stores the refreshPromise
   * so other calls that want to get a launchpad token know that a process is already doing that.
   *
   * @returns {Promise.<void>} refresh promise
   */
  async checkRefreshLaunchpadToken(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshLaunchpadToken().finally(() => {
      this.refreshPromise = undefined;
    });

    return this.refreshPromise;
  }

  /**
   * Refreshes the launchpad token due to authentication failures with launchpad. This function
   * calls getValidLaunchpadToken which creates a lock file in S3 at the token's location, to tell
   * other processes that a token recreation is in progress, fetches a new token from launchpad,
   * stores it as a part of the CMR singleton class, and then uses that one for calls
   *
   * @returns {Promise.<void>} refresh promise
   */
  private async refreshLaunchpadToken(): Promise<void> {
    if (!this.passphrase || !this.api || !this.certificate) {
      throw new Error(
        'Cannot refresh Launchpad token: passphrase, api, and certificate must all be set on the CMR client'
      );
    }
    this.token = await getValidLaunchpadToken({
      passphrase: this.passphrase,
      api: this.api,
      certificate: this.certificate,
    });
  }

  /**
  * Runs a CMR operation with retry logic for launchpad failures. If the operation fails with a
  * 401, refresh the Launchpad token and retry.
  *
  * @param {() => Promise} operation - the CMR function with args to execute
  * @param {number} [retries=5] - number of retry attempts on 401
  * @returns {Promise} - result of CMR function call
  */
  async withCmrLaunchpadTokenRefreshRetry<T>(
    operation: () => Promise<T>,
    retries: number = 5
  ): Promise<T> {
    if (this.oauthProvider !== 'launchpad') {
      return await operation();
    }

    try {
      return await pRetry(
        async () => {
          try {
            return await operation();
          } catch (error) {
            if (error.statusCode !== 401) {
              throw new pRetry.AbortError(error);
            }
            throw error;
          }
        },
        {
          retries,
          onFailedAttempt: async (error) => {
            if (error.retriesLeft > 0) {
              log.warn(
                `CMR call failed with 401 on attempt ${error.attemptNumber}, `
                + 'refreshing launchpad token and retrying'
              );
              await this.checkRefreshLaunchpadToken();
            }
          },
        }
      );
    } catch (error) {
      if (error.statusCode === 401) {
        log.error(
          `CMR call failed with 401 after ${retries + 1} attempts; exhausted retries`
        );
        throw Object.assign(
          new Error(
            `CMR launchpad authentication failed after ${retries + 1} attempts: ${error.message}`
          ),
          { statusCode: 401, cause: error }
        );
      }
      throw error;
    }
  }

  /**
   * Return object containing CMR request headers for PUT / POST / DELETE
   *
   * @param {Object} params
   * @param {string} [params.token] - CMR request token
   * @param {string} [params.ummgVersion] - UMMG metadata version string or null if echo10 metadata
   * @param {string} [params.cmrRevisionId] - CMR Revision ID
   * @returns {Object} CMR headers object
   */
  getWriteHeaders(
    params: {
      token?: string,
      ummgVersion?: string,
      cmrRevisionId?: string,
    } = {}
  ): Headers {
    const contentType = params.ummgVersion
      ? `application/vnd.nasa.cmr.umm+json;version=${params.ummgVersion}`
      : 'application/echo10+xml';

    const headers: Headers = {
      'Client-Id': this.clientId,
      'Content-type': contentType,
    };

    if (params.token) {
      headers.Authorization = params.token;
    }
    if (params.ummgVersion) headers.Accept = 'application/json';
    if (params.cmrRevisionId) headers['Cmr-Revision-Id'] = params.cmrRevisionId;

    return headers;
  }

  /**
   * Return object containing CMR request headers for GETs
   *
   * @param {Object} params
   * @param {string} [params.token] - CMR request token
   * @returns {Object} CMR headers object
   */
  getReadHeaders(params: { token?: string } = {}): Headers {
    const headers: Headers = {
      'Client-Id': this.clientId,
    };

    if (params.token) {
      headers.Authorization = params.token;
    }
    return headers;
  }

  /**
   * Adds a collection record to the CMR
   *
   * @param {string} xml - the collection XML document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestCollection(xml: string): Promise<unknown> {
    return await this.withCmrLaunchpadTokenRefreshRetry(async () => {
      const headers = this.getWriteHeaders({ token: await this.getToken() });
      return await ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, headers);
    });
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule XML document
   * @param {string} cmrRevisionId - Optional CMR Revision ID
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml: string, cmrRevisionId?: string): Promise<unknown> {
    return await this.withCmrLaunchpadTokenRefreshRetry(async () => {
      const headers = this.getWriteHeaders({ token: await this.getToken(), cmrRevisionId });
      return await ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, headers);
    });
  }

  /**
   * Adds/Updates UMMG json metadata in the CMR
   *
   * @param {Object} ummgMetadata - UMMG metadata object
   * @param {string} cmrRevisionId - Optional CMR Revision ID
   * @returns {Promise<Object>} to the CMR response object.
   */
  async ingestUMMGranule(ummgMetadata: UmmMetadata, cmrRevisionId?: string)
    : Promise<CMRResponseBody | CMRErrorResponseBody> {
    return await this.withCmrLaunchpadTokenRefreshRetry(async () => {
      const headers = this.getWriteHeaders({
        token: await this.getToken(),
        ummgVersion: ummVersion(ummgMetadata),
        cmrRevisionId,
      });

      const granuleId = ummgMetadata.GranuleUR || 'no GranuleId found on input metadata';
      logDetails.granuleId = granuleId;

      try {
        const response = await got.put(
          `${getIngestUrl({ provider: this.provider })}granules/${granuleId}`,
          {
            json: ummgMetadata,
            responseType: 'json',
            headers,
          }
        );
        return <CMRResponseBody>response.body;
      } catch (error) {
        log.error(error, logDetails);
        const statusCode = get(error, 'response.statusCode', error.code);
        const statusMessage = get(error, 'response.statusMessage', error.message);
        let errorMessage = `Failed to ingest, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;

        const responseError = get(error, 'response.body.errors');
        if (responseError) {
          errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(responseError)}`;
        }

        log.error(errorMessage);

        if (statusCode >= 500 && statusCode < 600) {
          throw new CMRInternalError(errorMessage);
        }

        throw Object.assign(new Error(errorMessage), { statusCode, cause: error });
      }
    });
  }

  /**
   * Deletes a collection record from the CMR
   *
   * @param {string} datasetID - the collection unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteCollection(datasetID: string): Promise<unknown> {
    return await this.withCmrLaunchpadTokenRefreshRetry(async () => {
      const headers = this.getWriteHeaders({ token: await this.getToken() });
      return await deleteConcept('collections', datasetID, this.provider, headers);
    });
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR: string): Promise<unknown> {
    return await this.withCmrLaunchpadTokenRefreshRetry(async () => {
      const headers = this.getWriteHeaders({ token: await this.getToken() });
      return await deleteConcept('granules', granuleUR, this.provider, headers);
    });
  }

  async searchConcept(
    type: string,
    searchParams: URLSearchParams,
    format = 'json',
    recursive = true
  ): Promise<unknown[]> {
    const headers = this.getReadHeaders({ token: await this.getToken() });
    return await searchConcept({
      type,
      searchParams,
      previousResults: [],
      headers,
      format,
      recursive,
    });
  }

  /**
   * Search in collections
   *
   * @param {string} params - the search parameters
   * @param {string} [format=json] - format of the response
   * @returns {Promise.<Object>} the CMR response
   */
  async searchCollections(
    params: { [key: string]: string },
    format = 'json'
  ): Promise<unknown[]> {
    const searchParams = new URLSearchParams({
      provider_short_name: this.provider,
      ...params,
    });

    return await this.searchConcept(
      'collections',
      searchParams,
      format
    );
  }

  /**
   * Search in granules
   *
   * @param {string} params - the search parameters
   * @param {string} [format='json'] - format of the response
   * @returns {Promise.<Object>} the CMR response
   */
  async searchGranules(
    params: { [key: string]: string },
    format = 'json'
  ): Promise<unknown[]> {
    const searchParams = new URLSearchParams({
      provider_short_name: this.provider,
      ...params,
    });

    return await this.searchConcept(
      'granules',
      searchParams,
      format
    );
  }

  /**
   * Get the granule metadata from CMR using the cmrLink
   *
   * @param {string} cmrLink - URL to concept
   * @returns {Object} - metadata as a JS object, null if not found
   */
  async getGranuleMetadata(cmrLink: string): Promise<unknown> {
    const headers = this.getReadHeaders({ token: await this.getToken() });
    return await getConceptMetadata(cmrLink, headers);
  }
}
