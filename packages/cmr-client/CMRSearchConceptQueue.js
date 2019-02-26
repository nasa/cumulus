'use strict';

const searchConcept = require('./searchConcept');

// Class to efficiently list all of the concepts (collections/granules) from CMR search, without
// loading them all into memory at once.  Handles paging.
class CMRSearchConceptQueue {
  /**
   * The constructor for the CMRSearchConceptQueue class
   *
   * @param {string} provider - the CMR provider id
   * @param {string} clientId - the CMR clientId
   * @param {string} type - the type of search 'granule' or 'collection'
   * @param {string} params - the search parameters
   * @param {string} format - the result format
   */
  constructor(provider, clientId, type, params, format) {
    this.clientId = clientId;
    this.provider = provider;
    this.type = type;
    this.params = Object.assign({}, { provider_short_name: this.provider }, params);
    this.format = format;
    this.items = [];
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
    if (this.items.length === 0) await this.fetchItems();
    return this.items[0];
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an item from the CMR search
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  /**
   * Query the CMR API to get the next batch of items
   *
   * @returns {Promise<undefined>} - resolves when the queue has been updated
   * @private
   */
  async fetchItems() {
    const results = await searchConcept(this.type, this.params, [], { 'Client-Id': this.clientId }, this.format, false);
    this.items = results;
    this.params.page_num = (this.params.page_num) ? this.params.page_num + 1 : 1;
    if (results.length === 0) this.items.push(null);
  }
}

module.exports = CMRSearchConceptQueue;
