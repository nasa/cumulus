'use strict';

const CMR = require('./CMR');

/**
 * A class to efficiently list all of the concepts (collections/granules) from
 * CMR search, without loading them all into memory at once.  Handles paging.
 *
 * @typicalname cmrSearchConceptQueue
 *
 * @example
 * const { CMRSearchConceptQueue } = require('@cumulus/cmr-client');
 *
 * const cmrSearchConceptQueue = new CMRSearchConceptQueue({
 *   provider: 'my-provider',
 *   clientId: 'my-clientId',
 *   type: 'granule',
 *   searchParams: {},
 *   format: 'json'
 * });
 */
class CMRSearchConceptQueue {
  /**
   * The constructor for the CMRSearchConceptQueue class
   *
   * @param {Object} params
   * @param {string} params.cmrSettings - the CMR settings for the requests - the provider,
   * clientId, and either launchpad token or EDL username and password
   * @param {string} params.type - the type of search 'granule' or 'collection'
   * @param {string} [params.searchParams={}] - the search parameters
   * @param {string} params.format - the result format
   */
  constructor(params = { searchParams: {} }) {
    this.type = params.type;
    this.params = { provider_short_name: params.cmrSettings.provider, ...params.searchParams };
    this.format = params.format;
    this.items = [];

    this.CMR = new CMR(params.cmrSettings);
  }

  /**
   * View the next item in the queue
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} an item from the CMR search
   */
  async peek() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items[0];
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns `null`.
   *
   * @returns {Promise<Object>} an item from the CMR search
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  /**
   * Query the CMR API to get the next batch of items
   *
   * @returns {Promise<undefined>} resolves when the queue has been updated
   * @private
   */
  async fetchItems() {
    const results = await this.CMR.searchConcept(
      this.type,
      this.params,
      this.format
    );
    this.items = results;
    this.params.page_num = (this.params.page_num) ? this.params.page_num + 1 : 1;
    if (results.length === 0) this.items.push(null);
  }
}

module.exports = CMRSearchConceptQueue;
