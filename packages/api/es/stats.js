'use strict';

const moment = require('moment');
const omit = require('lodash.omit');

const { BaseSearch } = require('./search');

class Stats extends BaseSearch {
  /**
   * Remove stats-specific fields, then create search
   *
   * @returns {Object} - search params
   */
  _buildSearch() {
    this.params = omit(
      this.params,
      [
        'type',
        'interval',
        'format',
        'field'
      ]
    );

    return super._buildSearch();
  }

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
    // For collections we are getting the distinct collection ids
    searchParams.body.aggs = {
      averageDuration: {
        avg: {
          field: 'duration'
        }
      },
      granulesStatus: {
        terms: {
          field: 'status'
        }
      },
      collections: {
        cardinality: {
          field: 'collectionId'
        }
      }
    };

    const granules = await this.client.search(searchParams)
      .then((response) => response.body);

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
        dateFrom,
        dateTo,
        value: granules.aggregations.collections.value,
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

  async count() {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    const field = this.params.field || 'status';

    const searchParams = this._buildSearch();
    searchParams.type = this.type;
    searchParams.size = 0;
    searchParams.body.aggs = {
      count: {
        terms: { field }
      }
    };

    const count = await this.client.search(searchParams)
      .then((response) => response.body);

    return {
      meta: {
        name: 'cumulus-api',
        count: count.hits.total,
        field: field
      },
      count: count.aggregations.count.buckets.map((b) => ({
        key: b.key,
        count: b.doc_count
      }))
    };
  }
}

module.exports = Stats;
