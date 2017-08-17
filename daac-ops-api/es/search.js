/* This code is copied from sat-api-lib library
 * with some alterations.
 * source: https://raw.githubusercontent.com/sat-utils/sat-api-lib/master/libs/search.js
 */

'use strict';

const has = require('lodash.has');
const omit = require('lodash.omit');
const moment = require('moment');
const aws = require('aws-sdk');
const httpAwsEs = require('http-aws-es');
const elasticsearch = require('elasticsearch');
const queries = require('./queries');
const aggs = require('./aggregations');

const logDetails = {
  file: 'lib/es/search.js',
  type: 'apigateway'
};

class BaseSearch {
  static async es() {
    let esConfig;

    // this is needed for getting temporary credentials from IAM role
    if (process.env.MODE === 'local') {
      esConfig = {
        host: 'localhost:9200'
      };
    }
    else {
      if (!aws.config.credentials) {
        await new Promise((resolve, reject) => aws.config.getCredentials((err) => {
          if (err) return reject(err);
          return resolve();
        }));
      }

      esConfig = {
        host: process.env.ES_HOST || 'localhost:9200',
        connectionClass: httpAwsEs,
        amazonES: {
          region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
          credentials: aws.config.credentials
        },

        // Note that this doesn't abort the query.
        requestTimeout: 50000  // milliseconds
      };
    }

    return new elasticsearch.Client(esConfig);
  }

  constructor(event, type = null, index = null) {
    let params = {};

    this.type = type;
    this.client = null;

    // this will allow us to receive payload
    // from GET and POST requests
    if (event.queryStringParameters) {
      params = event.queryStringParameters;
    }

    // get page number
    const page = parseInt((params.page) ? params.page : 1, 10);
    this.params = params;
    //log.debug('Generated params:', params, logDetails);

    this.size = parseInt((params.limit) ? params.limit : 1, 10);

    // max size is 100 for performance reasons
    this.size = this.size > 100 ? 100 : this.size;

    this.frm = (page - 1) * this.size;
    this.page = parseInt((params.skip) ? params.skip : page, 10);
    this.index = index || `${process.env.StackName}-${process.env.Stage}`;

    if (this.type === process.env.CollectionsTable) {
      this.hash = 'collectionName';
    }
    else if (this.type === process.env.PDRsTable) {
      this.hash = 'pdrName';
    }
  }

  _buildSearch(granuleStats = false) {
    let fields;

    // if fields are included remove it from params
    if (has(this.params, 'fields')) {
      fields = this.params.fields;
      this.params = omit(this.params, ['fields']);
    }

    let body = queries(this.params);
    if (granuleStats) {
      body = Object.assign(
        {},
        body,
        this._buildGranuleStats()
      );
    }

    return {
      index: this.index,
      body: body,
      size: this.size,
      from: this.frm,
      type: this.type,
      _source: fields
    };
  }

  _buildAggregation() {
    const aggrs = { aggs: {} };

    if (has(this.params, 'fields')) {
      const fields = this.params.fields.split(',');

      fields.forEach((field) => {
        if (field === 'createdAt') {
          aggrs.aggs = Object.assign(aggrs.aggs, aggs.date(field));
        }
        else {
          aggrs.aggs = Object.assign(aggrs.aggs, aggs.term(field));
        }
      });

      this.params = omit(this.params, ['fields']);
    }

    return {
      index: this.index,
      body: Object.assign({}, aggrs, queries(this.params)),
      type: this.type,
      size: 0
    };
  }

  _metaTemplate() {
    return {
      name: 'cumulus-api',
      table: this.type
    };
  }

  async get(id) {
    try {
      const body = {
        query: {
          term: {
            _id: id
          }
        }
      };

      logDetails.granuleId = id;

      if (!this.client) {
        this.client = await this.constructor.es();
      }

      const result = await this.client.search({
        index: this.index,
        type: this.type,
        body: body
      });

      if (result.hits.total > 1) {
        return { detail: 'More than one record was found!' };
      }
      else if (result.hits.total === 0) {
        return { detail: 'Record not found' };
      }

      return result.hits.hits[0]._source;
    }
    catch (e) {
      //log.error(e, logDetails);
      throw e;
    }
  }

  async granulesStats(key, value) {
    const body = {
      query: {
        term: {
          [`${key}.keyword`]: value
        }
      },
      aggs: {
        statusCount: {
          terms: {
            field: 'status.keyword'
          }
        },
        averageDuration: {
          avg: {
            field: 'duration'
          }
        },
        granulesCount: {
          value_count: {
            field: 'granuleId.keyword'
          }
        }
      }
    };

    const ag = await this.client.search({
      index: this.index,
      type: process.env.GranulesTable,
      body: body,
      size: 0
    });

    const status = {
      failed: 0,
      ingesting: 0,
      processing: 0,
      archiving: 0,
      cmr: 0,
      completed: 0
    };

    const item = ag.aggregations;

    const newObj = {
      averageDuration: item.averageDuration.value,
      granules: item.granulesCount.value,
      granulesStatus: Object.assign({}, status)
    };

    item.statusCount.buckets.forEach((b) => {
      newObj.granulesStatus[b.key] = b.doc_count;
    });

    if (newObj.granules > 0) {
      newObj.progress = (
        (
          (newObj.granulesStatus.completed + newObj.granulesStatus.failed) /
          newObj.granules
        )
        * 100
      );
    }
    else {
      newObj.progress = 0;
    }

    return newObj;
  }


  async query() {
    const searchParams = this._buildSearch();

    try {
      // search ES with the generated parameters
      if (!this.client) {
        this.client = await this.constructor.es();
      }
      const result = await this.client.search(searchParams);

      const response = result.hits.hits.map(s => s._source);

      const meta = this._metaTemplate();
      meta.limit = this.size;
      meta.page = this.page;
      meta.count = result.hits.total;

      return {
        meta,
        results: response
      };
    }
    catch (e) {
      //log.error(e, logDetails);
      return e;
    }
  }

  async count() {
    const searchParams = this._buildAggregation();

    try {
      if (!this.client) {
        this.client = await this.constructor.es();
      }

      const result = await this.client.search(searchParams);
      const count = result.hits.total;

      return {
        meta: {
          found: count,
          name: 'cumulus-api'
        },
        counts: result.aggregations
      };
    }
    catch (e) {
      //log.error(e, logDetails);
      return e;
    }
  }

}

export class Search extends BaseSearch {}

export class LogSearch extends BaseSearch {
  constructor(event, type = null) {
    super(event, type);
    this.index = `${process.env.StackName}-${process.env.Stage}-logs`;
  }
}

export class Stats extends BaseSearch {

  async query() {
    if (!this.client) {
      this.client = await this.constructor.es();
    }

    // we have to run three separate queries to get
    // errors from logs, granules and collections from
    // the main index and resources numbers

    // resources - just get the latest
    const resources = await this.client.search({
      index: this.index,
      type: process.env.ResourcesTable,
      size: 1,
      body: {
        sort: [{
          timestamp: { order: 'desc' }
        }]
      }
    });

    // granules
    const searchParams = this._buildSearch();
    searchParams.size = 0;
    delete searchParams.from;
    searchParams.type = process.env.GranulesTable;

    // add aggregation
    searchParams.body.aggs = {
      averageDuration: {
        avg: {
          field: 'totalDuration'
        }
      },
      granulesStatus: {
        terms: {
          field: 'status.keyword'
        }
      }
    };

    const granules = await this.client.search(searchParams);

    const collections = await this.client.count({
      index: this.index,
      type: process.env.CollectionsTable
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
      },
      resources: resources.hits.hits.map(s => s._source)
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

    const field = `${this.params.field}.keyword` || 'status.keyword';

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
