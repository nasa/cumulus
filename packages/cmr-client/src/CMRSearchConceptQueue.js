'use strict';

const CMR = require('./CMR');

/**
 * Shim to correctly add a default provider_short_name to the input searchParams
 *
 * @param {Object} params
 * @param {Object|URLSearchParams} params.searchParams - input search
 *  parameters for searchConceptQueue. This parameter can be either a
 *  URLSearchParam object or a plain Object.
 * @returns {Object|URLSearchParams} - input object appeneded with a default provider_short_name
 */
const provideParams = (params = { searchParams: {} }) => {
  if (params.searchParams instanceof URLSearchParams) {
    if (!params.searchParams.has('provider_short_name')) params.searchParams.append('provider_short_name', params.cmrSettings.provider);
    return params.searchParams;
  }
  return { provider_short_name: params.cmrSettings.provider, ...params.searchParams };
};

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
    this.params = provideParams(params);
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
      this.format,
      false
    );
    this.items = results;
    this.params.page_num = (this.params.page_num) ? this.params.page_num + 1 : 1;
    if (results.length === 0) this.items.push(null);
  }
}

module.exports = CMRSearchConceptQueue;
