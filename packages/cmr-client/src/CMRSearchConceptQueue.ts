import { CMR, CMRConstructorParams } from './CMR';

/**
 * Shim to correctly add a default provider_short_name to the input searchParams
 */
export const providerParams = ({
  searchParams = new URLSearchParams(),
  cmrSettings,
}: {
  searchParams?: URLSearchParams,
  cmrSettings: {
    provider: string
  }
}): URLSearchParams => {
  if (!searchParams.has('provider_short_name')) {
    searchParams.append('provider_short_name', cmrSettings.provider);
  }

  return searchParams;
};

export interface CMRSearchConceptQueueConstructorParams {
  cmrSettings: CMRConstructorParams,
  type: string,
  searchParams?: URLSearchParams,
  format?: string
}

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
export class CMRSearchConceptQueue<T> {
  type: string;
  params: URLSearchParams;
  format?: string;
  items: (T | null)[];
  CMR: CMR;

  /**
   * The constructor for the CMRSearchConceptQueue class
   *
   * @param {Object} params
   * @param {Object} params.cmrSettings - the CMR settings for the requests - the provider,
   * clientId, and either launchpad token or EDL username and password
   * @param {string} params.type - the type of search 'granule' or 'collection'
   * @param {URLSearchParams} [params.searchParams={}] - the search parameters
   * @param {string} params.format - the result format
   */
  constructor(params: CMRSearchConceptQueueConstructorParams) {
    this.type = params.type;
    this.params = providerParams({
      searchParams: params.searchParams,
      cmrSettings: params.cmrSettings,
    });
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
   */
  async peek(): Promise<T | null> {
    if (this.items.length === 0) await this.fetchItems();
    if (this.items[0] === null) {
      return null;
    }
    return this.items[0];
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns `null`.
   */
  async shift(): Promise<T | null> {
    if (this.items.length === 0) await this.fetchItems();
    const item = this.items.shift();
    // eslint-disable-next-line lodash/prefer-is-nil
    if (item === null || item === undefined) {
      return null;
    }
    return item;
  }

  /**
   * Query the CMR API to get the next batch of items
   *
   * @returns {Promise<undefined>} resolves when the queue has been updated
   * @private
   */
  async fetchItems(): Promise<void> {
    const results = await this.CMR.searchConcept(
      this.type,
      this.params,
      this.format,
      false
    );
    this.items = results as T[];

    const paramsPageNum = this.params.get('page_num') ?? '0';
    this.params.set('page_num', String(Number(paramsPageNum) + 1));

    // eslint-disable-next-line unicorn/no-null
    if (results.length === 0) this.items.push(null);
  }
}
