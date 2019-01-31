'use strict';

const got = require('got');
const fs = require('fs');
const property = require('lodash.property');
const { parseString } = require('xml2js');

const log = require('@cumulus/common/log');
const { deprecate } = require('@cumulus/common/util');

const {
  getUrl,
  updateToken,
  validate,
  xmlParseOptions
} = require('./utils');

const logDetails = {
  file: 'lib/cmrjs/index.js',
  source: 'pushToCMR',
  type: 'processing'
};

/**
 *
 * @param {string} type - Concept type to search, choices: ['collections', 'granules']
 * @param {Object} searchParams - CMR search parameters
 * @param {Array} previousResults - array of results returned in previous recursive calls
 * @param {Object} headers - the CMR headers
 * @returns {Promise.<Array>} - array of search results.
 */
async function _searchConcept(type, searchParams, previousResults = [], headers) {
  const recordsLimit = process.env.CMR_LIMIT || 100;
  const pageSize = searchParams.pageSize || process.env.CMR_PAGE_SIZE || 50;

  const defaultParams = { page_size: pageSize };

  const url = `${getUrl('search')}${type}.json`;

  const pageNum = (searchParams.page_num) ? searchParams.page_num + 1 : 1;

  // Recursively retrieve all the search results for collections or granules
  const query = Object.assign({}, defaultParams, searchParams, { page_num: pageNum });

  const response = await got.get(url, { json: true, query, headers });
  const fetchedResults = previousResults.concat(response.body.feed.entry || []);

  const numRecordsCollected = fetchedResults.length;
  const CMRHasMoreResults = response.headers['cmr-hits'] > numRecordsCollected;
  const recordsLimitReached = numRecordsCollected >= recordsLimit;
  if (CMRHasMoreResults && !recordsLimitReached) {
    return _searchConcept(type, query, fetchedResults, headers);
  }
  return fetchedResults.slice(0, recordsLimit);
}

/* eslint-disable-next-line valid-jsdoc */
/** deprecation wrapper for searchConcept see _searchConcept */
async function searchConcept(type, searchParams, previousResults = [], headers = {}) {
  deprecate('@cmrjs/searchConcept', '1.11.1', '@cmrjs/CMR.search(Collections|Granules)');
  return _searchConcept(type, searchParams, previousResults, headers);
}


/**
 * Posts a records of any kind (collection, granule, etc) to
 * CMR
 *
 * @param {string} type - the concept type. Choices are: collection, granule
 * @param {string} xml - the CMR record in xml
 * @param {string} identifierPath - the concept's unique identifier
 * @param {string} provider - the CMR provider id
 * @param {Object} headers - the CMR headers
 * @returns {Promise.<Object>} the CMR response object
 */
async function _ingestConcept(type, xml, identifierPath, provider, headers) {
  // Accept either an XML file, or an XML string itself
  let xmlString = xml;
  if (fs.existsSync(xml)) {
    xmlString = fs.readFileSync(xml, 'utf8');
  }

  let xmlObject = await new Promise((resolve, reject) => {
    parseString(xmlString, xmlParseOptions, (err, obj) => {
      if (err) reject(err);
      resolve(obj);
    });
  });

  //log.debug('XML object parsed', logDetails);
  const identifier = property(identifierPath)(xmlObject);
  logDetails.granuleId = identifier;

  try {
    await validate(type, xmlString, identifier, provider);
    //log.debug('XML object is valid', logDetails);

    //log.info('Pushing xml metadata to CMR', logDetails);
    const response = await got.put(
      `${getUrl('ingest', provider)}${type}s/${identifier}`,
      {
        body: xmlString,
        headers
      }
    );

    //log.info('Metadata pushed to CMR.', logDetails);

    xmlObject = await new Promise((resolve, reject) => {
      parseString(response.body, xmlParseOptions, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });

    if (xmlObject.errors) {
      const xmlObjectError = JSON.stringify(xmlObject.errors.error);
      throw new Error(`Failed to ingest, CMR error message: ${xmlObjectError}`);
    }

    return xmlObject;
  }
  catch (e) {
    log.error(e, logDetails);
    throw e;
  }
}

/* eslint-disable-next-line valid-jsdoc */
/** deprecation wrapper for ingestConcept see _ingestConcept */
async function ingestConcept(type, xml, identifierPath, provider, headers) {
  deprecate('@cmrjs/ingestConcept', '1.11.1', '@cmrjs/CMR.ingest(Collection|Granule)');
  return _ingestConcept(type, xml, identifierPath, provider, headers);
}
/**
 * Deletes a record from the CMR
 *
 * @param {string} type - the concept type. Choices are: collection, granule
 * @param {string} identifier - the record id
 * @param {string} provider - the CMR provider id
 * @param {Object} headers - the CMR headers
 * @returns {Promise.<Object>} the CMR response object
 */
async function _deleteConcept(type, identifier, provider, headers) {
  const url = `${getUrl('ingest', provider)}${type}/${identifier}`;
  log.info(`deleteConcept ${url}`);

  let result;
  try {
    result = await got.delete(url, {
      headers
    });
  }
  catch (error) {
    result = error.response;
  }

  const xmlObject = await new Promise((resolve, reject) => {
    parseString(result.body, xmlParseOptions, (err, res) => {
      if (err) reject(err);
      resolve(res);
    });
  });

  let errorMessage;
  if (result.statusCode !== 200) {
    errorMessage = `Failed to delete, statusCode: ${result.statusCode}, statusMessage: ${result.statusMessage}`;
    if (xmlObject.errors) {
      errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(xmlObject.errors.error)}`;
    }
    log.info(errorMessage);
  }

  if (result.statusCode !== 200 && result.statusCode !== 404) {
    throw new Error(errorMessage);
  }

  return xmlObject;
}

/* eslint-disable-next-line valid-jsdoc */
/** deprecation wrapper for deleteConcept see _deleteConcept */
async function deleteConcept(type, identifier, provider, headers) {
  deprecate('@cmrjs/deleteConcept', '1.11.1', '@cmrjs/CMR.delete(Collection|Granule)');
  return _deleteConcept(type, identifier, provider, headers);
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
   * @returns {Object} CMR headers object
   */
  getHeaders(token = null) {
    const headers = {
      'Client-Id': this.clientId,
      'Content-type': 'application/echo10+xml'
      // ummg: 'application/vnd.nasa.cmr.umm+json;version=1.4'  TODO [MHS, 2019-01-08]
    };
    if (token) headers['Echo-Token'] = token;
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
    return _ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, headers);
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule xml document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml) {
    const headers = this.getHeaders(await this.getToken());
    return _ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, headers);
  }

  /**
   * Deletes a collection record from the CMR
   *
   * @param {string} datasetID - the collection unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteCollection(datasetID) {
    const headers = this.getHeaders(await this.getToken());
    return _deleteConcept('collection', datasetID, headers);
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR) {
    const headers = this.getHeaders(await this.getToken());
    return _deleteConcept('granules', granuleUR, this.provider, headers);
  }

  /**
   * Search in collections
   *
   * @param {string} searchParams - the search parameters
   * @returns {Promise.<Object>} the CMR response
   */
  async searchCollections(searchParams) {
    const params = Object.assign({}, { provider_short_name: this.provider }, searchParams);
    return _searchConcept('collections', params, [], { 'Client-Id': this.clientId });
  }

  /**
   * Search in granules
   *
   * @param {string} searchParams - the search parameters
   * @returns {Promise.<Object>} the CMR response
   */
  async searchGranules(searchParams) {
    const params = Object.assign({}, { provider_short_name: this.provider }, searchParams);
    return _searchConcept('granules', params, [], { 'Client-Id': this.clientId });
  }
}

module.exports = {
  searchConcept,
  ingestConcept,
  deleteConcept,
  CMR
};
