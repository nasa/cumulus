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

const logDetails: { [key: string]: string } = {
  file: 'cmr-client/CMR.js',
};
/**
 * Returns a valid a CMR token
 *
 * @param {string} username - CMR username
 * @param {string} password - CMR password
 * @returns {Promise.<string>} the token
 *
 * @private
 */
async function updateToken(
  username: string,
  password: string
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/dot-notation
  const edlEnv = process.env['CMR_ENVIRONMENT'];
  if (!edlEnv) throw new Error('CMR_ENVIRONMENT not set');
  return await getEDLToken(username, password, edlEnv);
}

export interface CMRConstructorParams {
  clientId: string,
  password?: string,
  passwordSecretName?: string
  provider: string,
  token?: string,
  username: string,
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
 */
export class CMR {
  clientId: string;
  provider: string;
  username: string;
  oauthProvider: string;
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
   * @param {string} params.oauthProvider - Oauth provider: earthdata or launchpad
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
   * The method for getting the token
   *
   * @returns {Promise.<string>} the token
   */
  async getToken(): Promise<string> {
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
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return await ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, headers);
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule XML document
   * @param {string} cmrRevisionId - Optional CMR Revision ID
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml: string, cmrRevisionId?: string): Promise<unknown> {
    const headers = this.getWriteHeaders({ token: await this.getToken(), cmrRevisionId });
    return await ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, headers);
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
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return await deleteConcept('collections', datasetID, this.provider, headers);
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR: string): Promise<unknown> {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return await deleteConcept('granules', granuleUR, this.provider, headers);
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
