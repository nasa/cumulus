/* This code is copied from sat-api-lib library
 * with some alterations.
 * source: https://raw.githubusercontent.com/sat-utils/sat-api-lib/master/libs/search.js
 */

'use strict';

const has = require('lodash.has');
const omit = require('lodash.omit');
const aws = require('aws-sdk');
const httpAwsEs = require('http-aws-es');
const elasticsearch = require('elasticsearch');
const { inTestMode } = require('@cumulus/common/test-utils');
const queries = require('./queries');
const aggs = require('./aggregations');

const logDetails = {
  file: 'lib/es/search.js',
  type: 'apigateway'
};

const defaultIndexAlias = 'cumulus-alias';

class BaseSearch {
  /**
   * returns the local address of elasticsearch based on
   * the environment variables set
   *
   * @returns {string} elasticsearch local address
   */
  static getLocalEsHost() {
    if (process.env.LOCAL_ES_HOST) {
      return `${process.env.LOCAL_ES_HOST}:9200`;
    }
    if (process.env.LOCALSTACK_HOST) {
      return `${process.env.LOCALSTACK_HOST}:4571`;
    }

    return 'localhost:9200';
  }

  static async es(host) {
    let esConfig;

    // this is needed for getting temporary credentials from IAM role
    if (inTestMode()) {
      if (!process.env.LOCALSTACK_HOST) {
        throw new Error('The LOCALSTACK_HOST environment variable is not set.');
      }

      esConfig = {
        host: BaseSearch.getLocalEsHost()
      };
    } else {
      if (!aws.config.credentials) {
        await new Promise((resolve, reject) => aws.config.getCredentials((err) => {
          if (err) return reject(err);
          return resolve();
        }));
      }

      esConfig = {
        host: process.env.ES_HOST || host || 'localhost:9200',
        connectionClass: httpAwsEs,
        amazonES: {
          region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
          credentials: aws.config.credentials
        },

        // Note that this doesn't abort the query.
        requestTimeout: 50000 // milliseconds
      };
    }

    return new elasticsearch.Client(esConfig);
  }

  constructor(event, type = null, index) {
    let params = {};
    const logLimit = 10;

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

    this.size = parseInt((params.limit) ? params.limit : logLimit, 10);

    // max size is 100 for performance reasons
    this.size = this.size > 100 ? 100 : this.size;

    this.frm = (page - 1) * this.size;
    this.page = parseInt((params.skip) ? params.skip : page, 10);
    this.index = index || defaultIndexAlias;

    if (this.type === process.env.CollectionsTable) {
      this.hash = 'collectionName';
    } else if (this.type === process.env.PdrsTable) {
      this.hash = 'pdrName';
    }
  }

  _buildSearch() {
    let fields;

    // if fields are included remove it from params
    if (has(this.params, 'fields')) {
      fields = this.params.fields;
      this.params = omit(this.params, ['fields']);
    }

    const body = queries(this.params);

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
        } else {
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
      stack: process.env.stackName,
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
      if (result.hits.total === 0) {
        return { detail: 'Record not found' };
      }

      const resp = result.hits.hits[0]._source;
      resp._id = result.hits.hits[0]._id;
      return resp;
    } catch (e) {
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
          (newObj.granulesStatus.completed + newObj.granulesStatus.failed)
          / newObj.granules
        )
        * 100
      );
    } else {
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

      const response = result.hits.hits.map((s) => s._source);

      const meta = this._metaTemplate();
      meta.limit = this.size;
      meta.page = this.page;
      meta.count = result.hits.total;

      return {
        meta,
        results: response
      };
    } catch (e) {
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
    } catch (e) {
      //log.error(e, logDetails);
      return e;
    }
  }
}

class Search extends BaseSearch {}

module.exports = {
  BaseSearch,
  Search,
  defaultIndexAlias
};
