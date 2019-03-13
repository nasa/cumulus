'use strict';

const fs = require('fs');
const cmrClient = require('@cumulus/cmr-client');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);

// searchConcept is being imported for backwards compat,
// but is not part of the cmr-client public API
const _searchConcept = require('@cumulus/cmr-client/searchConcept');
// ingestConcept is being imported for backwards compat,
// but is not part of the cmr-client public API
const _ingestConcept = require('@cumulus/cmr-client/ingestConcept');
// deleteConcept is being imported for backwards compat,
// but is not part of the cmr-client public API
const _deleteConcept = require('@cumulus/cmr-client/deleteConcept');
const { deprecate } = require('@cumulus/common/util');

/* eslint-disable-next-line valid-jsdoc */
/** deprecation wrapper for searchConcept see _searchConcept */
async function searchConcept(type, searchParams, previousResults = [], headers = {}) {
  deprecate('@cmrjs/searchConcept', '1.11.1', '@cmrjs/CMR.search(Collections|Granules)');
  return _searchConcept({
    type,
    searchParams,
    previousResults,
    headers,
    cmrLimit: process.env.CMR_LIMIT,
    cmrPageSize: process.env.CMR_PAGE_SIZE
  });
}

/* eslint-disable-next-line valid-jsdoc */
/** deprecation wrapper for ingestConcept see _ingestConcept */
async function ingestConcept(type, xml, identifierPath, provider, headers) {
  deprecate('@cmrjs/ingestConcept', '1.11.1', '@cmrjs/CMR.ingest(Collection|Granule)');
  return _ingestConcept(type, xml, identifierPath, provider, headers);
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
   * @deprecated
   *
   * @param {string} provider - the CMR provider id
   * @param {string} clientId - the CMR clientId
   * @param {string} username - CMR username
   * @param {string} password - CMR password
   */
  constructor(provider, clientId, username, password) {
    deprecate('@cmrjs/CMR', '1.11.3');

    this.provider = provider;
    this.cmrClient = new cmrClient.CMR({
      provider,
      clientId,
      username,
      password
    });
  }

  /**
   * The method for getting the token
   *
   * @returns {Promise.<string>} the token
   */
  async getToken() {
    return this.cmrClient.getToken();
  }

  /**
   * Return object containing CMR request headers
   *
   * @param {string} [token] - CMR request token
   * @param {string} ummgVersion - UMMG metadata version string or null if echo10 metadata
   * @returns {Object} CMR headers object
   */
  getHeaders(token = null, ummgVersion = null) {
    return this.cmrClient.getHeaders({ token, ummgVersion });
  }

  /**
   * Adds a collection record to the CMR
   *
   * @param {string} xml - the collection xml document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestCollection(xml) {
    let xmlString;
    try {
      xmlString = await readFile(xml, 'utf8');
    }
    catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENAMETOOLONG') xmlString = xml;
      else throw err;
    }

    return this.cmrClient.ingestCollection(xmlString);
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule xml document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml) {
    let xmlString;
    try {
      xmlString = await readFile(xml, 'utf8');
    }
    catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENAMETOOLONG') xmlString = xml;
      else throw err;
    }

    return this.cmrClient.ingestGranule(xmlString);
  }

  /**
   * Adds/Updates UMMG json metadata in the CMR
   *
   * @param {Object} ummgMetadata - UMMG metadata object
   * @returns {Promise<Object>} to the CMR response object.
   */
  async ingestUMMGranule(ummgMetadata) {
    return this.cmrClient.ingestUMMGranule(ummgMetadata);
  }

  /**
   * Deletes a collection record from the CMR
   *
   * @param {string} datasetID - the collection unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteCollection(datasetID) {
    return this.cmrClient.deleteCollection(datasetID);
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR) {
    return this.cmrClient.deleteGranule(granuleUR);
  }

  /**
   * Search in collections
   *
   * @param {string} searchParams - the search parameters
   * @param {string} format - format of the response
   * @returns {Promise.<Object>} the CMR response
   */
  async searchCollections(searchParams, format = 'json') {
    const params = Object.assign({}, { provider_short_name: this.provider }, searchParams);
    return this.cmrClient.searchCollections(params, format);
  }

  /**
   * Search in granules
   *
   * @param {string} searchParams - the search parameters
   * @param {string} format - format of the response
   * @returns {Promise.<Object>} the CMR response
   */
  async searchGranules(searchParams, format = 'json') {
    const params = Object.assign({}, { provider_short_name: this.provider }, searchParams);
    return this.cmrClient.searchGranules(params, format);
  }
}

// Class to efficiently list all of the concepts (collections/granules) from CMR search, without
// loading them all into memory at once.  Handles paging.
class CMRSearchConceptQueue {
  /**
   * The constructor for the CMRSearchConceptQueue class
   *
   * @deprecated
   *
   * @param {string} provider - the CMR provider id
   * @param {string} clientId - the CMR clientId
   * @param {string} type - the type of search 'granule' or 'collection'
   * @param {string} searchParams - the search parameters
   * @param {string} format - the result format
   */
  constructor(provider, clientId, type, searchParams, format) {
    deprecate('@cmrjs/CMRSearchConceptQueue', '1.11.3');

    this.cmrClientSearchConceptQueue = new cmrClient.CMRSearchConceptQueue({
      provider,
      clientId,
      type,
      searchParams,
      format
    });
  }

  /**
   * View the next item in the queue
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an item from the CMR search
   */
  async peek() {
    return this.cmrClientSearchConceptQueue.peek();
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an item from the CMR search
   */
  async shift() {
    return this.cmrClientSearchConceptQueue.shift();
  }

  /**
   * Query the CMR API to get the next batch of items
   *
   * @returns {Promise<undefined>} - resolves when the queue has been updated
   * @private
   */
  async fetchItems() {
    this.CMRSearchConceptQueue.fetchItems();
  }
}

module.exports = {
  _searchConcept,
  searchConcept,
  ingestConcept,
  deleteConcept,
  CMR,
  CMRSearchConceptQueue
};
