const fs = require('fs');
const got = require('got');
const property = require('lodash.property');
const { parseString } = require('xml2js');
const log = require('@cumulus/common/log');
const {
  validate,
  ValidationError,
  updateToken,
  getUrl,
  xmlParseOptions,
  getHost
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
 * @param {Array} existingResults - array of results returned in previous recursive calls
 * @returns {Promise.<Array>} - array of search results.
 */
async function searchConcept(type, searchParams, existingResults = []) {
  const limitRecords = process.env.CMR_LIMIT || 100;
  const pageSize = searchParams.pageSize || process.env.CMR_PAGE_SIZE || 50;
  let pageNum = 1;

  if (searchParams.page_num) {
    pageNum = searchParams.page_num + 1;
  }

  // Recursively retrieve all the search results for collections or granules
  const queryObject = Object.assign({ page_size: pageSize }, searchParams, { page_num: pageNum });

  const response = await got.get(`${getUrl('search')}${type}.json`, { query: queryObject });
  const body = JSON.parse(response.body);
  const _existingResults = existingResults.concat(body.feed.entry || []);

  const numRecordsCollected = _existingResults.length;
  const areThereMoreResults = response.headers['cmr-hits'] > numRecordsCollected;
  if (areThereMoreResults && numRecordsCollected < limitRecords) {
    return searchConcept(type, queryObject, _existingResults);
  }
  return _existingResults.slice(0, limitRecords);
}


/**
 * Posts a records of any kind (collection, granule, etc) to
 * CMR
 *
 * @param {string} type - the concept type. Choices are: collection, granule
 * @param {string} xml - the CMR record in xml
 * @param {string} identifierPath - the concept's unique identifier
 * @param {string} provider - the CMR provider id
 * @param {string} token - the CMR token
 * @returns {Promise.<Object>} the CMR response object
 */
async function ingestConcept(type, xml, identifierPath, provider, token) {
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
        headers: {
          'Echo-Token': token,
          'Content-type': 'application/echo10+xml'
        }
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

/**
 * Deletes a record from the CMR
 *
 * @param {string} type - the concept type. Choices are: collection, granule
 * @param {string} identifier - the record id
 * @param {string} provider - the CMR provider id
 * @param {string} token - the CMR token
 * @returns {Promise.<Object>} the CMR response object
 */
async function deleteConcept(type, identifier, provider, token) {
  const url = `${getUrl('ingest', provider)}${type}/${identifier}`;
  log.info(`deleteConcept ${url}`);

  let result;
  try {
    result = await got.delete(url, {
      headers: {
        'Echo-Token': token,
        'Content-type': 'application/echo10+xml'
      }
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

/**
 * Get the CMR JSON metadata from the cmrLink
 *
 * @param {string} cmrLink - link to concept in CMR
 * @returns {Object} - metadata as a JS object, null if not
 * found
 */
async function getMetadata(cmrLink) {
  const response = await got.get(cmrLink);

  if (response.statusCode !== 200) {
    return null;
  }

  const body = JSON.parse(response.body);

  return body.feed.entry[0];
}

/**
 * Get the full metadata from CMR as a JS object by getting
 * the echo10 metadata
 *
 * @param {string} cmrLink - link to concept in CMR. This link is a json
 * link that comes from task output.
 * @returns {Object} - Full metadata as a JS object
 */
async function getFullMetadata(cmrLink) {
  const xmlLink = cmrLink.replace('json', 'echo10');

  const response = await got.get(xmlLink);

  if (response.statusCode !== 200) {
    return null;
  }

  const xmlObject = await new Promise((resolve, reject) => {
    parseString(response.body, xmlParseOptions, (err, res) => {
      if (err) reject(err);
      resolve(res);
    });
  });

  return xmlObject.Granule;
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
   * Adds a collection record to the CMR
   *
   * @param {string} xml - the collection xml document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestCollection(xml) {
    const token = await this.getToken();
    return ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, token);
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule xml document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml) {
    const token = await this.getToken();
    return ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, token);
  }

  /**
   * Deletes a collection record from the CMR
   *
   * @param {string} datasetID - the collection unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteCollection(datasetID) {
    return deleteConcept('collection', datasetID);
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR) {
    const token = await this.getToken();
    return deleteConcept('granules', granuleUR, this.provider, token);
  }

  /**
   * Search in collections
   *
   * @param {string} searchParams - the search parameters
   * @returns {Promise.<Object>} the CMR response
   */
  async searchCollections(searchParams) {
    const params = Object.assign({}, { provider_short_name: this.provider }, searchParams);
    return searchConcept('collections', params, []);
  }

  /**
   * Search in granules
   *
   * @param {string} searchParams - the search parameters
   * @returns {Promise.<Object>} the CMR response
   */
  async searchGranules(searchParams) {
    const params = Object.assign({}, { provider_short_name: this.provider }, searchParams);
    return searchConcept('granules', params, []);
  }
}

module.exports = {
  ingestConcept,
  deleteConcept,
  getUrl,
  updateToken,
  ValidationError,
  CMR,
  getMetadata,
  getFullMetadata,
  getHost,
  searchConcept
};
