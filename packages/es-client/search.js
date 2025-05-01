//@ts-check
/* This code is copied from sat-api-lib library
 * with some alterations.
 * source: https://raw.githubusercontent.com/sat-utils/sat-api-lib/master/libs/search.js
 */
/* eslint-disable max-classes-per-file */

'use strict';

const has = require('lodash/has');
const omit = require('lodash/omit');
const isString = require('lodash/isString');
const isError = require('lodash/isError');
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

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}

/**
 * Sanitizes sensitive data in error messages or logs
 *
 * @param {Error|string} input - The error object or message to sanitize
 * @returns {Error|string} - Sanitized error or message
 */
const sanitizeSensitive = (input) => {
  const sensitiveFields = [
    `${process.env.METRICS_ES_USER}:${process.env.METRICS_ES_PASS}`,
  ].filter(Boolean);

  let message = isString(input) ? input : input.message || input.toString();

  const escapeRegExp = (string) => string.replace(/[$()*+.?[\\\]^{|}-]/g, '\\$&');

  sensitiveFields.forEach((field) => {
    if (field) {
      const pattern = `(^|\\s|[^a-zA-Z0-9_])(${escapeRegExp(field)})($|\\s|[^a-zA-Z0-9_])`;
      message = message.replace(new RegExp(pattern, 'g'), '$1*****$3');
    }
  });

  if (isString(input)) {
    return message;
  }

  const sanitizedError = new Error(message);
  sanitizedError.stack = input.stack;
  return sanitizedError;
};

/**
 * Custom logger for elasticsearch client to sanitize sensitive data
 */
class EsCustomLogger {
  constructor() {
    this.levels = ['error', 'warning']; // Log only errors and warnings
  }

  error(message) {
    logger.error(sanitizeSensitive(message));
  }

  warning(message) {
    logger.warn(sanitizeSensitive(message));
  }

  info() {}

  debug() {}

  trace() {}
}

/**
 * Returns the local address of elasticsearch based on
 * environment variables
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

/**
 * Retrieves AWS credentials using the `fromNodeProviderChain` function.
 */
const getAwsCredentials = async () => {
  const credentialsProvider = fromNodeProviderChain({
    clientConfig: {
      region: process.env.AWS_REGION,
    },
  });
  const creds = await credentialsProvider();
  return creds;
};

const esTestConfig = () => ({
  node: getLocalEsHost(),
  requestTimeout: 5000,
  ssl: {
    rejectUnauthorized: false,
  },
});

/**
 * Generates a configuration for Elasticsearch in a production environment.
 *
 * @param {string | undefined} host - The host URL for the Elasticsearch instance.
 *  If not provided, the function will use the `ES_HOST` environment variable.
 * @param {import('@aws-sdk/types').AwsCredentialIdentity | undefined} credentials - The
 *  AWS credentials for accessing the Elasticsearch instance.
 * @returns
 * -  The configuration object for Elasticsearch, including the node address,
 * AWS connection details, and request timeout.
 */
const esProdConfig = (host, credentials) => {
  let node = 'http://localhost:9200';

  if (process.env.ES_HOST) {
    node = `https://${process.env.ES_HOST}`;
  } else if (host) {
    node = `https://${host}`;
  }
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

  const encodedUser = encodeURIComponent(process.env.METRICS_ES_USER);
  const encodedPass = encodeURIComponent(process.env.METRICS_ES_PASS);
  const node = `https://${encodedUser}:${encodedPass}@${process.env.METRICS_ES_HOST}`;

  return {
    node,
    requestTimeout: 50000,
    log: EsCustomLogger,
  };
};

/**
 * Generates a configuration for Elasticsearch based on the environment
 * and provided parameters.
 *
 * @param {string} [host] - The host URL for the Elasticsearch instance.
 * @param {boolean} [metrics=false] - A flag indicating whether metrics are enabled.
 * @returns {Promise<[Object, import('@aws-sdk/types').Credentials | undefined]>} A
 * promise that resolves to a tuple containing the configuration object and
 * AWS credentials (if applicable).
 */
const esConfig = async (host, metrics = false) => {
  let config;
  let credentials;
  if (inTestMode() || 'LOCAL_ES_HOST' in process.env) {
    config = esTestConfig();
  } else if (metrics) {
    config = esMetricsConfig();
  } else {
    credentials = await getAwsCredentials();
    config = esProdConfig(host, credentials);
  }
  return [config, credentials];
};

/**
 * `EsClient` is a class for managing an Elasticsearch client.
 *
 * @property {string} host - The host URL for the Elasticsearch instance.
 * @property {boolean} metrics - A flag indicating whether metrics are enabled.
 * @property {elasticsearch.Client} _client - The Elasticsearch client instance.
 *
 * @method constructor - Initializes a new instance of the `EsClient` class.
 * @method initializeEsClient - Initializes the Elasticsearch client (this._client/client)
 * if it hasn't been initialized yet.
 * @method refreshClient - Refreshes the Elasticsearch client if the AWS credentials have changed,
 * by creating a new Elasticsearch `Client` instance.
 * @method client - Getter that returns the current Elasticsearch Client
 */
class EsClient {
  /**
   *  Initializes the Elasticsearch client if it hasn't been initialized yet,
   * fetching AWS credentials if necessary.
   *
   * @returns {Promise<elasticsearch.Client>} A promise that resolves to an instance of
   * `elasticsearch.Client`.
   */
  async initializeEsClient() {
    /** @type {elasticsearch.Client | undefined} */
    let client = this._client;
    if (!client) {
      const [config, credentials] = await esConfig(this.host, this.metrics);
      if (credentials) {
        this._awsKeyId = credentials.accessKeyId;
      }
      client = new elasticsearch.Client(config);
      this._client = client;
    }
    return client;
  }

  /**
   * Asynchronously refreshes the Elasticsearch client if the AWS credentials have changed,
   * by creating a new Elasticsearch `Client` instance.
   *
   * @returns {Promise<void>} A promise that resolves when the credentials have been refreshed.
   */
  async refreshClient() {
    const { host, metrics } = this;
    if (this.metrics || inTestMode() || process.env.LOCAL_ES_HOST) {
      return;
    }
    const oldKey = this._awsKeyId;
    const newCreds = await getAwsCredentials();
    if (oldKey !== newCreds.accessKeyId) {
      logger.info('AWS Credentials updated, updating to new ESClient');
      const [config] = await esConfig(host, metrics); // Removed unused variable _creds
      this._client = new elasticsearch.Client(config);
      this._awsKeyId = newCreds.accessKeyId;
    }
  }

  /**
   * Getter that returns the Elasticsearch client instance if it's been initialized
   *
   * @returns {elasticsearch.Client | undefined} The Elasticsearch client instance.
   */
  get client() {
    return this._client;
  }

  /**
   * Initializes a new instance of the `EsClient` class.
   *
   * @param {string} [host] - The host URL for the Elasticsearch instance.
   * @param {boolean} [metrics=false] - A flag indicating whether metrics are enabled.
   */
  constructor(host, metrics = false) {
    this.host = host;
    this.metrics = metrics;
    if (metrics) {
      this.host = process.env.METRICS_ES_HOST;
    }
  }
}

/**
 * `BaseSearch` is a class for managing certain Cumulus Elasticsearch queries.
 *
 * @property {string | undefined} host - The host URL for the Elasticsearch instance.
 * @property {boolean} metrics - A flag indicating whether metrics are enabled.
 * @property {EsClient} _esClient - The Elasticsearch client instance.
 * @property {string | null} type - The type of the Elasticsearch index.
 * @property {Object} params - The query parameters.
 * @property {number} size - The number of results to return per page.
 * @property {number} frm - The starting index for the results.
 * @property {number} page - The current page number.
 * @property {string} index - The Elasticsearch index to query.
 *
 * @method initializeEsClient - Initializes the EsClient associated with the instance of this class
 * @method client - Returns the Elasticsearch client instance.
 * @method constructor - Initializes the `BaseSearch` instance, including the EsClient instance.
 * @method get - Retrieves a single document by id and/or parentId.
 * @method exists - Checks if a document exists by id and/or parentId.
 * @method query - Performs a search query.
 * @method count - Counts the number of documents in the index
 */
class BaseSearch {
  async initializeEsClient(host, metrics) {
    this._esClient = new EsClient(host, metrics);
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
    const esCustomLogger = new EsCustomLogger();
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

    try {
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
    } catch (error) {
      esCustomLogger.error(sanitizeSensitive(error));
      if (error.meta?.statusCode === 401) {
        throw new HttpError(401, 'Invalid credentials');
      }
      throw sanitizeSensitive(error);
    }
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
      const esCustomLogger = new EsCustomLogger();
      esCustomLogger.error(sanitizeSensitive(error));

      if (error.meta?.statusCode === 401) {
        throw new HttpError(401, 'Invalid credentials');
      }
      throw sanitizeSensitive(error);
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
      const esCustomLogger = new EsCustomLogger();
      esCustomLogger.error(sanitizeSensitive(error));

      if (error.meta?.statusCode === 401) {
        throw new HttpError(401, 'Invalid credentials');
      }
      throw sanitizeSensitive(error);
    }
  }
}

class Search extends BaseSearch {}

/**
 * Initializes and returns an instance of an `EsClient` Class
 *
 * @param {string} [host] - The host URL for the Elasticsearch instance.
 * @param {boolean} [metrics] - A flag indicating whether metrics are enabled.
 * @returns {Promise<EsClient>} A promise that resolves to an instance of `EsClient`.
 */
const getEsClient = async (host, metrics) => {
  const esClient = new EsClient(host, metrics);
  await esClient.initializeEsClient();
  return esClient;
};

module.exports = {
  esConfig,
  BaseSearch,
  Search,
  EsClient,
  getEsClient,
  defaultIndexAlias,
  multipleRecordFoundString,
  recordNotFoundString,
  getLocalEsHost,
  sanitizeSensitive,
  isError,
};
