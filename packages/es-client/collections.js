'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');

const { constructCollectionId } = require('@cumulus/message/Collections');

const { BaseSearch } = require('./search');

const ES_MAX_AGG = 2147483647;

class Collection extends BaseSearch {
  constructor(event, type, index, includeStats = false) {
    super(event, type || 'collection', index);
    this.includeStats = includeStats !== false;
    // decrease the limit to 50
    this.size = this.size > 50 ? 50 : this.size;
  }

  async getStats(records, ids) {
    if (!this._esClient) {
      await this.initializeEsClient();
    }

    const aggs = await this.client.search({
      index: this.index,
      type: this.type,
      body: {
        query: {
          terms: {
            _id: ids,
          },
        },
        aggs: {
          collections: {
            filter: {
              term: {
                _type: 'collection',
              },
            },
            aggs: {
              name: {
                terms: {
                  field: 'name.keyword',
                  size: ES_MAX_AGG,
                },
                aggs: {
                  version: {
                    terms: {
                      field: 'version.keyword',
                      size: ES_MAX_AGG,
                    },
                    aggs: {
                      stats: {
                        children: {
                          type: 'granule',
                        },
                        aggs: {
                          count: {
                            terms: {
                              field: 'status.keyword',
                              size: ES_MAX_AGG,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }).then((response) => response.body);

    return records.map((record) => {
      const updatedRecord = cloneDeep(record);

      updatedRecord.stats = {
        running: 0,
        completed: 0,
        failed: 0,
        total: 0,
      };

      const aggregations = get(aggs, 'aggregations.collections');
      const nameBucket = this._filterAggBuckets(
        aggregations.name.buckets, (agg) => agg.key === updatedRecord.name
      );
      const versionBucket = this._filterAggBuckets(
        get(nameBucket, 'version.buckets'), (agg) => agg.key === updatedRecord.version
      );

      if (versionBucket) {
        const stats = versionBucket.stats;
        updatedRecord.stats.total = stats.doc_count;
        stats.count.buckets.forEach((s) => {
          updatedRecord.stats[s.key] = s.doc_count;
        });
      }
      return updatedRecord;
    });
  }

  _filterAggBuckets(buckets, filter) {
    if (buckets === undefined) {
      return undefined;
    }

    const result = buckets.filter((agg) => filter(agg));
    if (result.length === 1) {
      return result[0];
    }
    if (result.length === 0) {
      return undefined;
    }
    throw new Error(`Statistics aggregation failed due to duplicate filter return ${JSON.stringify(buckets)}: ${JSON.stringify(result)}`);
  }

  /**
   * Get a list of collection ids from found granules. If time params
   * are specified the query will return collections that have granules that have been updated
   * in that time frame.  If granuleIds are provided, it will filter those as well.
   *
   * @returns {Promise<Array<string>>} - list of collection ids with active granules
   */
  async aggregateGranuleCollections() {
    if (!this._esClient) {
      await this.initializeEsClient();
    }

    // granules
    const searchParams = this._buildSearch();
    delete searchParams.from;
    searchParams.type = 'granule';

    searchParams.body.aggs = {
      collections: {
        terms: {
          field: 'collectionId.keyword',
          size: ES_MAX_AGG,
        },
      },
    };

    const searchResults = await this.client.search(searchParams)
      .then((response) => response.body);

    return searchResults.aggregations.collections.buckets.map((b) => b.key);
  }

  /**
   * Add collection granule stats to collection query results
   *
   * @param {Array<Object>} collectionResults - collection query results
   * @returns {Promise<Array<Object>>} - collectionResults updated with granule stats
   */
  addStatsToCollectionResults(collectionResults) {
    const ids = collectionResults.filter((r) => r.name && r.version)
      .map((c) => constructCollectionId(c.name, c.version));
    return this.getStats(collectionResults, ids);
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

  async query(searchParamsOverride) {
    const res = await super.query(searchParamsOverride);

    // get aggregations for results
    if (res.results && this.includeStats) {
      res.results = await this.addStatsToCollectionResults(res.results);
    }

    return res;
  }
}

module.exports = Collection;
