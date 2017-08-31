/* eslint-disable no-param-reassign */
'use strict';

const { BaseSearch } = require('./search');


class Collection extends BaseSearch {
  constructor(event, type = null, index = null) {
    type = type || 'collection';
    super(event, type, index);

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
    });

    // add aggs to res
    records = records.map(r => {
      r.stats = {
        running: 0,
        completed: 0,
        failed: 0,
        total: 0
      };
      for (const b of aggs.aggregations.hashes.buckets) {
        if (b.key === r.name) {
          r.stats.total = b.stats.doc_count;
          b.stats.count.buckets.forEach(s => {
            r.stats[s.key] = s.doc_count;
          });
          return r;
        }
      }
      return r;
    });

    return records;
  }

  async query() {
    const res = await super.query();

    // get aggregations for results
    const names = res.results.map(r => r.name);
    res.results = await this.getStats(res.results, names);

    return res;
  }
}

module.exports = Collection;
