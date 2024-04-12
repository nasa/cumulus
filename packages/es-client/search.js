/* This code is copied from sat-api-lib library
 * with some alterations.
 * source: https://raw.githubusercontent.com/sat-utils/sat-api-lib/master/libs/search.js
 */
/* eslint-disable max-classes-per-file */

'use strict';

const has = require('lodash/has');
const omit = require('lodash/omit');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const elasticsearch = require('@elastic/elasticsearch');

const { inTestMode } = require('@cumulus/common/test-utils');
const Logger = require('@cumulus/logger');

const createEsAmazonConnection = require('./esAmazonConnection');
const queries = require('./queries');
const aggs = require('./aggregations');

const logDetails = {
  file: 'lib/es/search.js',
  type: 'apigateway',
};

const defaultIndexAlias = 'cumulus-alias';
const multipleRecordFoundString = 'More than one record was found!';
const recordNotFoundString = 'Record not found';
const logger = new Logger({ sender: '@cumulus/es-client/search' });

/**
 * returns the local address of elasticsearch based on
 * the environment variables set
 *
 * @returns {string} elasticsearch local address
 */
const getLocalEsHost = () => {
  const port = process.env.LOCAL_ES_HOST_PORT || 9200;
  const protocol = (process.env.LOCAL_ES_HOST_PROTOCOL) ? process.env.LOCAL_ES_HOST_PROTOCOL : 'http';
  if (process.env.LOCAL_ES_HOST) return `${protocol}://${process.env.LOCAL_ES_HOST}:${port}`;
  if (process.env.LOCALSTACK_HOST) return `${protocol}://${process.env.LOCALSTACK_HOST}:4571`;
  return `${protocol}://localhost:9200`;
};

const getAwsCredentials = async () => {
  const credentialsProvider = fromNodeProviderChain({
    clientConfig: {
      region: process.env.AWS_REGION,
    },
  });
  return await credentialsProvider();
};

const esTestConfig = () => ({
  node: getLocalEsHost(),
  requestTimeout: 5000,
  ssl: {
    rejectUnauthorized: false,
  },
});

const esProdConfig = async (host) => {
  let node = 'http://localhost:9200';

  if (process.env.ES_HOST) {
    node = `https://${process.env.ES_HOST}`;
  } else if (host) {
    node = `https://${host}`;
  }
  const credentials = await getAwsCredentials();
  return {
    node,
    ...createEsAmazonConnection({
      credentials,
      region: process.env.AWS_REGION,
    }),

    // Note that this doesn't abort the query.
    requestTimeout: 50000, // milliseconds
  };
};

const esMetricsConfig = () => {
  if (!process.env.METRICS_ES_HOST
    || !process.env.METRICS_ES_USER
    || !process.env.METRICS_ES_PASS) {
    throw new Error('ELK Metrics stack not configured');
  }

  const node = `https://${process.env.METRICS_ES_USER}:${
    process.env.METRICS_ES_PASS}@${process.env.METRICS_ES_HOST}`;

  return {
    node,
    requestTimeout: 50000,
  };
};

const esConfig = async (host, metrics = false) => {
  let config;
  if (inTestMode() || 'LOCAL_ES_HOST' in process.env) {
    config = esTestConfig();
  } else if (metrics) {
    config = esMetricsConfig();
  } else {
    config = await esProdConfig(host);
  }
  return config;
};

/**
 * `EsClient` is a class for managing an Elasticsearch client.
 *
 * @property {string} host - The host URL for the Elasticsearch instance.
 * @property {boolean} metrics - A flag indicating whether metrics are enabled.
 * @property {Object} _client - The Elasticsearch client instance.
 *
 * @method constructor - Initializes a new instance of the `EsClient` class.
 * @method initializeEsClient - Initializes the Elasticsearch client (this._client/client)
 * if it hasn't been initialized yet.
 * @method refreshClient - Refreshes the Elasticsearch client if the AWS credentials have changed,
 * by creating a new Elasticsearch `Client` instance.
 * @method client - Getter that returns the Elasticsearch client instance.
 */
class EsClient {
  async initializeEsClient() {
    if (!this._esClient) {
      this._client = new elasticsearch.Client(await esConfig(this.host, this.metrics));
    }
    return this._client;
  }

  async refreshClient() {
    if (this.metrics) {
      return;
    }
    const oldKey = this._client.awsAccessKeyId;
    const newCreds = await getAwsCredentials();
    if (oldKey !== newCreds.accessKeyId) {
      logger.info('AWS Credentials updated, updating to new ESClient');
      this._client = new elasticsearch.Client(
        await esConfig(this.host, this.metrics)
      );
    }
  }

  get client() {
    return this._client;
  }

  constructor(host, metrics = false) {
    this.host = host;
    this.metrics = metrics;
    if (metrics) {
      this.host = process.env.METRICS_ES_HOST;
    }
  }
}

class BaseSearch {
  static async es(host, metrics) {
    return new elasticsearch.Client(await esConfig(host, metrics));
  }

  async initializeEsClient(host, metrics) {
    const esClient = new EsClient(host, metrics);
    this._esClient = esClient;
    await this._esClient.initializeEsClient();
  }

  get client() {
    return this._esClient ? this._esClient.client : undefined;
  }

  constructor(event = {}, type = null, index, metrics = false) {
    let params = {};
    const logLimit = 10;

    this.type = type;
    this.metrics = metrics;

    // this will allow us to receive payload
    // from GET and POST requests
    if (event.queryStringParameters) {
      params = event.queryStringParameters;
    }

    // get page number
    const page = Number.parseInt(params.page ? params.page : 1, 10);
    this.params = params;

    this.size = Number.parseInt(params.limit ? params.limit : logLimit, 10);

    // max size is 100 for performance reasons
    this.size = this.size > 100 ? 100 : this.size;

    this.frm = (page - 1) * this.size;
    this.page = Number.parseInt(params.skip ? params.skip : page, 10);
    this.index = index || defaultIndexAlias;
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
      _source: fields,
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
      body: { ...aggrs, ...queries(this.params) },
      type: this.type,
      size: 0,
    };
  }

  _metaTemplate() {
    return {
      name: 'cumulus-api',
      stack: process.env.stackName,
      table: this.type,
    };
  }

  async get(id, parentId) {
    const body = {
      query: {
        bool: {
          must: [
            {
              term: {
                _id: id,
              },
            },
          ],
        },
      },
    };

    if (parentId) {
      body.query.bool.must.push({
        parent_id: {
          id: parentId,
          type: this.type,
        },
      });
    }

    logDetails.granuleId = id;

    if (!this._esClient) {
      await this.initializeEsClient();
    }

    const result = await this.client.search({
      index: this.index,
      type: this.type,
      body,
    })
      .then((response) => response.body);

    if (result.hits.total > 1) {
      return { detail: multipleRecordFoundString };
    }
    if (result.hits.total === 0) {
      return { detail: recordNotFoundString };
    }

    const resp = result.hits.hits[0]._source;
    resp._id = result.hits.hits[0]._id;
    return resp;
  }

  async exists(id, parentId) {
    const response = await this.get(id, parentId);
    return response.detail !== recordNotFoundString;
  }

  async query(searchParamsOverride) {
    const searchParams = searchParamsOverride || this._buildSearch();

    try {
      // search ES with the generated parameters
      if (!this._esClient) {
        await this.initializeEsClient(null, this.metrics);
      }
      const response = await this.client.search(searchParams);
      const hits = response.body.hits.hits;

      const meta = this._metaTemplate();
      meta.limit = this.size;
      meta.page = this.page;
      meta.count = response.body.hits.total;
      if (hits.length > 0) {
        meta.searchContext = encodeURIComponent(
          JSON.stringify(hits[hits.length - 1].sort)
        );
      }

      return {
        meta,
        results: hits.map((s) => s._source),
      };
    } catch (error) {
      return error;
    }
  }

  async count() {
    const searchParams = this._buildAggregation();

    try {
      if (!this.esClient) {
        this.esClient = await this.initializeEsClient();
      }

      const result = await this.esClient.search(searchParams);
      const count = result.body.hits.total;

      return {
        meta: {
          found: count,
          name: 'cumulus-api',
        },
        counts: result.body.aggregations,
      };
    } catch (error) {
      return error;
    }
  }
}

class Search extends BaseSearch {}

const getEsClient = async (host, metrics) => {
  const esClient = new EsClient(host, metrics);
  await esClient.initializeEsClient();
  return esClient;
};

module.exports = {
  BaseSearch,
  Search,
  EsClient,
  getEsClient,
  defaultIndexAlias,
  multipleRecordFoundString,
  recordNotFoundString,
  getLocalEsHost,
};
