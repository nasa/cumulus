'use strict';

const moment = require('moment');
const { BaseSearch } = require('./search');

class Stats extends BaseSearch {

  async query() {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    // granules
    const searchParams = this._buildSearch();
    searchParams.size = 0;
    delete searchParams.from;
    searchParams.type = 'granule';

    // add aggregation
    searchParams.body.aggs = {
      averageDuration: {
        avg: {
          field: 'totalDuration'
        }
      },
      granulesStatus: {
        terms: {
          field: 'status'
        }
      }
    };

    const granules = await this.client.search(searchParams);

    const collections = await this.client.count({
      index: this.index,
      type: 'collection'
    });

    const dateFormat = 'YYYY-MM-DDThh:mm:ssZ';
    const dateFrom = moment(this.params.timestamp__from).format(dateFormat);
    const dateTo = moment(this.params.timestamp__to).format(dateFormat);

    let granulesErrors = 0;
    granules.aggregations.granulesStatus.buckets.forEach((b) => {
      if (b.key === 'failed') {
        granulesErrors = b.doc_count;
      }
    });

    return {
      errors: {
        dateFrom,
        dateTo,
        value: granulesErrors,
        aggregation: 'count',
        unit: 'error'
      },
      collections: {
        dateFrom: moment('1970-01-01').format(dateFormat),
        dateTo,
        value: collections.count,
        aggregation: 'count',
        unit: 'collection'
      },
      processingTime: {
        dateFrom,
        dateTo,
        value: granules.aggregations.averageDuration.value,
        aggregation: 'average',
        unit: 'second'
      },
      granules: {
        dateFrom,
        dateTo,
        value: granules.hits.total,
        aggregation: 'count',
        unit: 'granule'
      }
    };
  }

  async histogram() {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    const searchParams = this._buildSearch();
    const criteria = {
      field: this.params.field || 'timestamp',
      interval: this.params.interval || 'day',
      format: this.params.format || 'yyyy-MM-dd'
    };

    searchParams.size = 0;
    searchParams.body.aggs = {
      histogram: {
        date_histogram: criteria
      }
    };

    const hist = await this.client.search(searchParams);

    return {
      meta: {
        name: 'cumulus-api',
        count: hist.hits.total,
        criteria
      },
      histogram: hist.aggregations.histogram.buckets.map(b => ({
        date: b.key_as_string,
        count: b.doc_count
      }))
    };
  }

  async count() {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    const field = this.params.field || 'status';

    const searchParams = this._buildSearch();
    searchParams.size = 0;
    searchParams.body.aggs = {
      count: {
        terms: { field }
      }
    };

    const count = await this.client.search(searchParams);

    return {
      meta: {
        name: 'cumulus-api',
        count: count.hits.total,
        field: field
      },
      count: count.aggregations.count.buckets.map(b => ({
        key: b.key,
        count: b.doc_count
      }))
    };
  }

  async avg() {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    const field = this.params.field;
    if (!field) {
      throw new Error('field parameter must be provided');
    }

    const searchParams = this._buildSearch();
    searchParams.size = 0;
    searchParams.body.aggs = {
      stats: {
        extended_stats: { field }
      }
    };

    const stats = await this.client.search(searchParams);

    return {
      meta: {
        name: 'cumulus-api',
        count: stats.hits.total,
        field: field
      },
      stats: stats.aggregations.stats
    };
  }
}

module.exports = Stats;
