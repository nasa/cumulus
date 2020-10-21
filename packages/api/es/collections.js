'use strict';

const { constructCollectionId } = require('@cumulus/message/Collections');
const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const BaseCollection = require('./BaseCollection');

/**
* A Collection Class returns collection searches appended with statistical aggregations
*/
class Collection extends BaseCollection {
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
                  field: 'name',
                  size: this.ES_MAX_AGG,
                },
                aggs: {
                  version: {
                    terms: {
                      field: 'version',
                      size: this.ES_MAX_AGG,
                    },
                    aggs: {
                      stats: {
                        children: {
                          type: 'granule',
                        },
                        aggs: {
                          count: {
                            terms: {
                              field: 'status',
                              size: this.ES_MAX_AGG,
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
