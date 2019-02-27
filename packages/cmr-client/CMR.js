'use strict';

const got = require('got');
const get = require('lodash.get');
const publicIp = require('public-ip');
const Logger = require('@cumulus/logger');

const searchConcept = require('./searchConcept');
const ingestConcept = require('./ingestConcept');
const deleteConcept = require('./deleteConcept');
const getUrl = require('./getUrl');
const ValidationError = require('./ValidationError');

const log = new Logger({ sender: 'cmr-client' });

const logDetails = {
  file: 'cmr-client/CMR.js'
};

/**
 * Find the UMM version as a decimal string.
 * If a version cannot be found on the input object
 * version 1.4 is assumed and returned.
 *
 * @param {Object} umm - UMM metadata object
 * @returns {string} UMM version for the given object
 */
function ummVersion(umm) {
  return get(umm, 'MetadataSpecification.Version', '1.4');
}

/**
 * Posts a given xml string to the validate endpoint of CMR
 * and promises true of valid.
 *
 * @param {string} ummMetadata - the UMM object
 * @param {string} identifier - the document identifier
 * @param {string} provider - the CMR provider
 * @returns {Promise<boolean>} returns true if the document is valid
 */
async function validateUMMG(ummMetadata, identifier, provider) {
  const version = ummVersion(ummMetadata);
  let result;

  try {
    result = await got.post(`${getUrl('validate', provider)}granule/${identifier}`, {
      json: true,
      body: ummMetadata,
      headers: {
        Accept: 'application/json',
        'Content-type': `application/vnd.nasa.cmr.umm+json;version=${version}`
      }
    });

    if (result.statusCode === 200) {
      return true;
    }
  }
  catch (e) {
    result = e.response;
  }

  throw new ValidationError(
    `Validation was not successful. UMM metadata Object: ${JSON.stringify(ummMetadata)}`
  );
}

/**
 * Returns a valid a CMR token
 *
 * @param {string} cmrProvider - the CMR provider id
 * @param {string} clientId - the CMR clientId
 * @param {string} username - CMR username
 * @param {string} password - CMR password
 * @returns {Promise.<string>} the token
 */
async function updateToken(cmrProvider, clientId, username, password) {
  if (!cmrProvider) throw new Error('cmrProvider is required.');
  if (!clientId) throw new Error('clientId is required.');
  if (!username) throw new Error('username is required.');
  if (!password) throw new Error('password is required.');

  // Update the saved ECHO token
  // for info on how to add collections to CMR: https://cmr.earthdata.nasa.gov/ingest/site/ingest_api_docs.html#validate-collection
  let response;

  try {
    response = await got.post(getUrl('token'), {
      json: true,
      body: {
        token: {
          username: username,
          password: password,
          client_id: clientId,
          user_ip_address: await publicIp.v4().catch((_) => '127.0.0.1'),
          provider: cmrProvider
        }
      }
    });
  }
  catch (err) {
    if (err.response.body.errors) throw new Error(`CMR Error: ${err.response.body.errors[0]}`);
    throw err;
  }

  if (!response.body.token) throw new Error('Authentication with CMR failed');

  return response.body.token.id;
}

/**
 * The CMR class
 */
class CMR {
  /**
   * The constructor for the CMR class
   *
   * @param {string} provider - the CMR provider id
   * @param {string} clientId - the CMR clientId
   * @param {string} username - CMR username
   * @param {string} password - CMR password
   */
  constructor(provider, clientId, username, password) {
    this.clientId = clientId;
    this.provider = provider;
    this.username = username;
    this.password = password;
  }

  /**
   * The method for getting the token
   *
   * @returns {Promise.<string>} the token
   */
  async getToken() {
    return updateToken(this.provider, this.clientId, this.username, this.password);
  }

  /**
   * Return object containing CMR request headers
   *
   * @param {string} [token] - CMR request token
   * @param {string} ummgVersion - UMMG metadata version string or null if echo10 metadata
   * @returns {Object} CMR headers object
   */
  getHeaders(token = null, ummgVersion = null) {
    const contentType = !ummgVersion ? 'application/echo10+xml' : `application/vnd.nasa.cmr.umm+json;version=${ummgVersion}`;
    const headers = {
      'Client-Id': this.clientId,
      'Content-type': contentType
    };
    if (token) headers['Echo-Token'] = token;
    if (ummgVersion) headers.Accept = 'application/json';
    return headers;
  }

  /**
   * Adds a collection record to the CMR
   *
   * @param {string} xml - the collection xml document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestCollection(xml) {
    const headers = this.getHeaders(await this.getToken());
    return ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, headers);
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule xml document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml) {
    const headers = this.getHeaders(await this.getToken());
    return ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, headers);
  }

  /**
   * Adds/Updates UMMG json metadata in the CMR
   *
   * @param {Object} ummgMetadata - UMMG metadata object
   * @returns {Promise<Object>} to the CMR response object.
   */
  async ingestUMMGranule(ummgMetadata) {
    const ummgVersion = ummVersion(ummgMetadata);
    const headers = this.getHeaders(await this.getToken(), ummgVersion);

    const granuleId = ummgMetadata.GranuleUR || 'no GranuleId found on input metadata';
    logDetails.granuleId = granuleId;

    let response;
    try {
      await validateUMMG(ummgMetadata, granuleId, this.provider);

      response = await got.put(
        `${getUrl('ingest', this.provider)}granules/${granuleId}`,
        {
          json: true,
          body: ummgMetadata,
          headers
        }
      );
      if (response.body.errors) {
        throw new Error(`Failed to ingest, CMR Errors: ${response.errors}`);
      }
    }
    catch (error) {
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
  async deleteCollection(datasetID) {
    const headers = this.getHeaders(await this.getToken());
    return deleteConcept('collection', datasetID, headers);
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR) {
    const headers = this.getHeaders(await this.getToken());
    return deleteConcept('granules', granuleUR, this.provider, headers);
  }

  /**
   * Search in collections
   *
   * @param {string} searchParams - the search parameters
   * @param {string} searchParams.provider_short_name - provider shortname
   * @param {string} format - format of the response
   * @returns {Promise.<Object>} the CMR response
   */
  async searchCollections(searchParams, format = 'json') {
    return searchConcept('collections', searchParams, [], { 'Client-Id': this.clientId }, format);
  }

  /**
   * Search in granules
   *
   * @param {string} searchParams - the search parameters
   * @param {string} searchParams.provider_short_name - provider shortname
   * @param {string} format - format of the response
   * @returns {Promise.<Object>} the CMR response
   */
  async searchGranules(searchParams, format = 'json') {
    return searchConcept('granules', searchParams, [], { 'Client-Id': this.clientId }, format);
  }
}
module.exports = CMR;
