import get from 'lodash/get';
import got, { Headers } from 'got';
import publicIp from 'public-ip';
import Logger from '@cumulus/logger';
import * as secretsManagerUtils from '@cumulus/aws-client/SecretsManager';

import { searchConcept } from './searchConcept';
import ingestConcept from './ingestConcept';
import deleteConcept from './deleteConcept';
import getConcept from './getConcept';
import getUrl from './getUrl';
import { UmmMetadata, ummVersion, validateUMMG } from './UmmUtils';

const log = new Logger({ sender: 'cmr-client' });

const logDetails: { [key: string]: string } = {
  file: 'cmr-client/CMR.js',
};

const IP_TIMEOUT_MS = 1 * 1000;

const userIpAddress = (): Promise<string> =>
  publicIp.v4({ timeout: IP_TIMEOUT_MS })
    .catch(() => '127.0.0.1');

/**
 * Returns a valid a CMR token
 *
 * @param {string} cmrProvider - the CMR provider id
 * @param {string} clientId - the CMR clientId
 * @param {string} username - CMR username
 * @param {string} password - CMR password
 * @returns {Promise.<string>} the token
 *
 * @private
 */
async function updateToken(
  cmrProvider: string,
  clientId: string,
  username: string,
  password: string
): Promise<string> {
  const url = getUrl('token');
  if (!url) {
    throw new Error('Unable to determine token URL');
  }

  // Update the saved ECHO token
  // for info on how to add collections to CMR: https://cmr.earthdata.nasa.gov/ingest/site/ingest_api_docs.html#validate-collection
  let response: {
    body: {
      token?: {
        id: string
      }
    }
  };
  try {
    response = await got.post(url, {
      json: {
        token: {
          username: username,
          password: password,
          client_id: clientId,
          user_ip_address: await userIpAddress(),
          provider: cmrProvider,
        },
      },
      responseType: 'json',
    });
  } catch (error) {
    if (get(error, 'response.body.errors')) {
      throw new Error(`CMR Error: ${error.response.body.errors[0]}`);
    }
    throw error;
  }

  if (!response.body.token) throw new Error('Authentication with CMR failed');

  return response.body.token.id;
}

export interface CMRConstructorParams {
  clientId: string,
  password?: string,
  passwordSecretName?: string
  provider: string,
  token?: string,
  username: string
}

/**
 * A class to simplify requests to the CMR
 *
 * @typicalname cmrClient
 *
 * @example
 * const { CMR } from '@cumulus/cmr-client');
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
 */
export class CMR {
  clientId: string;
  provider: string;
  username: string;
  password?: string;
  passwordSecretName?: string;
  token?: string;

  /**
   * The constructor for the CMR class
   *
   * @param {Object} params
   * @param {string} params.provider - the CMR provider id
   * @param {string} params.clientId - the CMR clientId
   * @param {string} params.username - CMR username, not used if token is provided
   * @param {string} params.passwordSecretName - CMR password secret, not used if token is provided
   * @param {string} params.password - CMR password, not used if token or
   *  passwordSecretName is provided
   * @param {string} params.token - CMR or Launchpad token,
   * if not provided, CMR username and password are used to get a cmr token
   */
  constructor(params: CMRConstructorParams) {
    this.clientId = params.clientId;
    this.provider = params.provider;
    this.username = params.username;
    this.password = params.password;
    this.passwordSecretName = params.passwordSecretName;
    this.token = params.token;
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
   * The method for getting the token
   *
   * @returns {Promise.<string>} the token
   */
  async getToken(): Promise<string> {
    return this.token
      ? this.token
      : updateToken(this.provider, this.clientId, this.username, await this.getCmrPassword());
  }

  /**
   * Return object containing CMR request headers for PUT / POST / DELETE
   *
   * @param {Object} params
   * @param {string} [params.token] - CMR request token
   * @param {string} [params.ummgVersion] - UMMG metadata version string or null if echo10 metadata
   * @returns {Object} CMR headers object
   */
  getWriteHeaders(
    params: {
      token?: string,
      ummgVersion?: string
    } = {}
  ): Headers {
    const contentType = params.ummgVersion
      ? `application/vnd.nasa.cmr.umm+json;version=${params.ummgVersion}`
      : 'application/echo10+xml';

    const headers: Headers = {
      'Client-Id': this.clientId,
      'Content-type': contentType,
    };

    if (params.token) headers['Echo-Token'] = params.token;
    if (params.ummgVersion) headers.Accept = 'application/json';

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

    if (params.token) headers['Echo-Token'] = params.token;

    return headers;
  }

  /**
   * Adds a collection record to the CMR
   *
   * @param {string} xml - the collection XML document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestCollection(xml: string): Promise<unknown> {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, headers);
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule XML document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml: string): Promise<unknown> {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, headers);
  }

  /**
   * Adds/Updates UMMG json metadata in the CMR
   *
   * @param {Object} ummgMetadata - UMMG metadata object
   * @returns {Promise<Object>} to the CMR response object.
   */
  async ingestUMMGranule(ummgMetadata: UmmMetadata): Promise<unknown> {
    const headers = this.getWriteHeaders({
      token: await this.getToken(),
      ummgVersion: ummVersion(ummgMetadata),
    });

    const granuleId = ummgMetadata.GranuleUR || 'no GranuleId found on input metadata';
    logDetails.granuleId = granuleId;

    let response: {
      body: {
        errors?: unknown
      }
    };
    try {
      await validateUMMG(ummgMetadata, granuleId, this.provider);

      response = await got.put(
        `${getUrl('ingest', this.provider)}granules/${granuleId}`,
        {
          json: ummgMetadata,
          responseType: 'json',
          headers,
        }
      );
      if (response.body.errors) {
        throw new Error(`Failed to ingest, CMR Errors: ${response.body.errors}`);
      }
    } catch (error) {
      log.error(error, logDetails);
      throw error;
    }

    return response.body;
  }

  /**
   * Deletes a collection record from the CMR
   *
   * @param {string} datasetID - the collection unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteCollection(datasetID: string): Promise<unknown> {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return deleteConcept('collection', datasetID, this.provider, headers);
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR: string): Promise<unknown> {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return deleteConcept('granules', granuleUR, this.provider, headers);
  }

  async searchConcept(
    type: string,
    searchParams: URLSearchParams | string | Record<string, string>,
    format = 'json',
    recursive = true
  ): Promise<unknown> {
    const headers = this.getReadHeaders({ token: await this.getToken() });
    return searchConcept({
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
    params: {[key: string]: string},
    format = 'json'
  ): Promise<unknown> {
    const searchParams = { provider_short_name: this.provider, ...params };
    return this.searchConcept(
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
    params: {[key: string]: string},
    format = 'json'
  ): Promise<unknown> {
    const searchParams = { provider_short_name: this.provider, ...params };
    return this.searchConcept(
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
    return getConcept(cmrLink, headers);
  }
}
