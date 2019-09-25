'use strict';

const cloneDeep = require('lodash.clonedeep');
const { BaseSearch } = require('./search');


class Collection extends BaseSearch {
  constructor(event, type, index) {
    super(event, type || 'collection', index);

    // decrease the limit to 50
    this.size = this.size > 50 ? 50 : this.size;
  }

  async getStats(records, names) {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    const aggs = await this.client.search({
      index: this.index,
      type: this.type,
      body: {
        query: {
          terms: {
            name: names
          }
        },
        aggs: {
          hashes: {
            terms: {
              field: 'name'
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

      const matchingBucket = aggs.aggregations.hashes.buckets
        .find((bucket) => bucket.key === updatedRecord.name);

      if (matchingBucket) {
        updatedRecord.stats.total = matchingBucket.stats.doc_count;
        matchingBucket.stats.count.buckets.forEach((s) => {
          updatedRecord.stats[s.key] = s.doc_count;
        });
      }

      return updatedRecord;
    });
  }

  async query() {
    const res = await super.query();

    // get aggregations for results
    const names = res.results.map((r) => r.name).filter((name) => (name));
    res.results = await this.getStats(res.results, names);

    return res;
  }
}

module.exports = Collection;
