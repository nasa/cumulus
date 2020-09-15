'use strict';

const { constructCollectionId } = require('@cumulus/message/Collections');
const cloneDeep = require('lodash/cloneDeep');
const { BaseSearch } = require('./search');

class Collection extends BaseSearch {
  constructor(event, type, index) {
    super(event, type || 'collection', index);

    // decrease the limit to 50
    this.size = this.size > 50 ? 50 : this.size;
  }

  async getStats(records, ids) {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    const aggs = await this.client.search({
      index: this.index,
      type: this.type,
      body: {
        query: {
          terms: {
            _id: ids
          }
        },
        aggs: {
          hashes: {
            terms: {
              field: '_uid'
            },
            aggs: {
              stats: {
                children: {
                  type: 'granule'
                },
                aggs: {
                  count: {
                    terms: {
                      field: 'status'
                    }
                  }
                }
              }
            }
          }
        }
      },
      size: 0
    }).then((response) => response.body);

    // add aggs to res
    return records.map((record) => {
      const updatedRecord = cloneDeep(record);

      updatedRecord.stats = {
        running: 0,
        completed: 0,
        failed: 0,
        total: 0
      };

      // Can't aggregate on the _id but can on the _uid which is collection#_id
      const esUid = `collection#${constructCollectionId(updatedRecord.name, updatedRecord.version)}`;

      const matchingBucket = aggs.aggregations.hashes.buckets
        .find((bucket) => bucket.key === esUid);

      if (matchingBucket) {
        updatedRecord.stats.total = matchingBucket.stats.doc_count;
        matchingBucket.stats.count.buckets.forEach((s) => {
          updatedRecord.stats[s.key] = s.doc_count;
        });
      }

      return updatedRecord;
    });
  }

  /**
   * Get a list of collection ids that have granules. If time params
   * are specified the query will return collections that have granules that have been updated
   * in that time frame.
   *
   * @returns {Promise<Array<string>>} - list of collection ids with active granules
   */
  async aggregateActiveGranuleCollections() {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    // granules
    const searchParams = this._buildSearch();
    searchParams.size = 0;
    delete searchParams.from;
    searchParams.type = 'granule';

    searchParams.body.aggs = {
      collections: {
        terms: {
          field: 'collectionId'
        }
      }
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
    const collectionIds = await this.aggregateActiveGranuleCollections();

    const searchParams = this._buildSearch();
    searchParams.body.query = {
      constant_score: {
        filter: {
          terms: {
            _id: collectionIds
          }
        }
      }
    };

    const res = await this.query(searchParams);

    return res;
  }

  async query(searchParamsOverride) {
    const res = await super.query(searchParamsOverride);

    // get aggregations for results
    if (res.results) {
      res.results = await this.addStatsToCollectionResults(res.results);
    }

    return res;
  }
}

module.exports = Collection;
