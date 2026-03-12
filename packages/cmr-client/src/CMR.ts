/* eslint-disable no-await-in-loop */
import get from 'lodash/get';
import got, { Headers } from 'got';
import { CMRInternalError } from '@cumulus/errors';
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
const launchpad = require('@cumulus/launchpad-auth');

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
  passwordSecretName?: string
  provider: string,
  token?: string,
  username?: string,
  oauthProvider: string,
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
  clientId: string;
  provider: string;
  username?: string;
  oauthProvider: string;
  password?: string;
  passwordSecretName?: string;
  token?: string;

  /**
   * The constructor for the CMR class
   */
  constructor(params: CMRConstructorParams) {
    this.clientId = params.clientId;
    this.provider = params.provider;
    this.username = params.username;
    this.password = params.password;
    this.passwordSecretName = params.passwordSecretName;
    this.token = params.token;
    this.oauthProvider = params.oauthProvider;
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
  * Get the number of runs and launchpad passphrase for retrying CMR concept requests
  * that require authentication
  *
  * @returns {Promise<{ runs: number, passphrase: string }>} Retry configuration containing
  * the maximum number of retry attempts along with the launchpad passphrase.
  */
  async getRetryConceptConfig() {
    const runs = 10;
    const launchpadPassphraseSecretName = this.passwordSecretName || process.env.launchpad_passphrase_secret_name || '';
    const passphrase = await secretsManagerUtils.getSecretString(
      launchpadPassphraseSecretName
    );
    return { runs, passphrase };
  }

  /**
  * Handle the error from CMR concept requests that require authentication
  * @param {any} error - the error thrown from the CMR request
  * @param {number} run - the current retry attempt
  * @param {string} [passphrase] - launchpad passphrase for getting a new token
  * @returns {Promise<void>}
  */
  async handleAuthRetry(error: any, run: number, passphrase: string | undefined) {
    if (error.statusCode !== 401) {
      throw new Error(error.statusMessage || error.message);
    }

    if (this.oauthProvider === 'launchpad') {
      this.token = undefined;
      const config = {
        passphrase,
        api: process.env.launchpad_api,
        certificate: process.env.launchpad_certificate,
      };
      this.token = await launchpad.getLaunchpadToken(config);
    }

    const delay = 2 ** run * 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));
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
    const { runs, passphrase } = await this.getRetryConceptConfig();
    for (let run = 0; run < runs; run += 1) {
      try {
        const headers = this.getWriteHeaders({ token: await this.getToken() });
        return await ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, headers);
      } catch (error) {
        await this.handleAuthRetry(error, run, passphrase);
      }
    }
    throw new Error('ingestCollection failed after retries');
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule XML document
   * @param {string} cmrRevisionId - Optional CMR Revision ID
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml: string, cmrRevisionId?: string): Promise<unknown> {
    const { runs, passphrase } = await this.getRetryConceptConfig();
    for (let run = 0; run < runs; run += 1) {
      try {
        const headers = this.getWriteHeaders({ token: await this.getToken(), cmrRevisionId });
        return await ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, headers);
      } catch (error) {
        await this.handleAuthRetry(error, run, passphrase);
      }
    }
    throw new Error('ingestGranule failed after retries');
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

      throw new Error(errorMessage);
    }
  }

  /**
   * Deletes a collection record from the CMR
   *
   * @param {string} datasetID - the collection unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteCollection(datasetID: string): Promise<unknown> {
    const { runs, passphrase } = await this.getRetryConceptConfig();

    for (let run = 0; run < runs; run += 1) {
      try {
        const headers = this.getWriteHeaders({ token: await this.getToken() });
        return await deleteConcept('collections', datasetID, this.provider, headers);
      } catch (error) {
        await this.handleAuthRetry(error, run, passphrase);
      }
    }
    throw new Error('deleteCollection failed after retries');
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR: string): Promise<unknown> {
    const { runs, passphrase } = await this.getRetryConceptConfig();

    for (let run = 0; run < runs; run += 1) {
      try {
        const headers = this.getWriteHeaders({ token: await this.getToken() });
        return await deleteConcept('granules', granuleUR, this.provider, headers);
      } catch (error) {
        await this.handleAuthRetry(error, run, passphrase);
      }
    }
    throw new Error('deleteGranule failed after retries');
  }

  async searchConcept(
    type: string,
    searchParams: URLSearchParams,
    format = 'json',
    recursive = true
  ): Promise<unknown[]> {
    const { runs, passphrase } = await this.getRetryConceptConfig();

    for (let run = 0; run < runs; run += 1) {
      try {
        const headers = this.getReadHeaders({ token: await this.getToken() });
        return await searchConcept({
          type,
          searchParams,
          previousResults: [],
          headers,
          format,
          recursive,
        });
      } catch (error) {
        await this.handleAuthRetry(error, run, passphrase);
      }
    }
    throw new Error('searchConcept failed after retries');
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
    const { runs, passphrase } = await this.getRetryConceptConfig();

    for (let run = 0; run < runs; run += 1) {
      try {
        const headers = this.getReadHeaders({ token: await this.getToken() });
        return await getConceptMetadata(cmrLink, headers);
      } catch (error) {
        await this.handleAuthRetry(error, run, passphrase);
      }
    }
    throw new Error('getGranuleMetadata failed after retries');
  }
}
