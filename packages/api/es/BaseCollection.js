'use strict';

const { BaseSearch } = require('./search');
const ES_MAX_AGG = 2147483647;

class BaseCollection extends BaseSearch {
  constructor(event, type, index) {
    super(event, type || 'collection', index);
    this.ES_MAX_AGG = ES_MAX_AGG;
  }

  /**
   * Get a list of collection ids from found granules. If time params
   * are specified the query will return collections that have granules that have been updated
   * in that time frame.  If granuleIds are provided, it will filter those as well.
   *
   * @returns {Promise<Array<string>>} - list of collection ids with active granules
   */
  async aggregateGranuleCollections() {
    if (!this.client) {
      this.client = await this.constructor.es();
    }
    // granules
    const searchParams = this._buildSearch();
    delete searchParams.from;
    searchParams.type = 'granule';

    searchParams.body.aggs = {
      collections: {
        terms: {
          field: 'collectionId',
          size: this.ES_MAX_AGG,
        },
      },
    };

    const searchResults = await this.client.search(searchParams)
      .then((response) => response.body);

    return searchResults.aggregations.collections.buckets.map((b) => b.key);
  }

  /**
   * Perform a collection query to return collections that have granules. If time params
   * are specified the query will return collections that have granules that have been updated
   * in that time frame.
   *
   * @returns {Promise<Object>} - query result object containing collections and their granule stats
   */
  async queryCollectionsWithActiveGranules() {
    const collectionIds = await this.aggregateGranuleCollections();

    const searchParams = this._buildSearch();
    searchParams.body.query = {
      constant_score: {
        filter: {
          terms: {
            _id: collectionIds,
          },
        },
      },
    };

    const res = await this.query(searchParams);

    return res;
  }
}

module.exports = BaseCollection;
