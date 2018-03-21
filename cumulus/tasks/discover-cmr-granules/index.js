'use strict';

const parseDuration = require('parse-duration');
const fetch = require('node-fetch');
const log = require('@cumulus/common/log');
const Task = require('@cumulus/common/task');
const FieldPattern = require('@cumulus/common/field-pattern');
const docClient = require('@cumulus/common/aws').dynamodbDocClient();
const querystring = require('querystring');
const moment = require('moment');

/**
 * Validate presence of parameter in config
 *
 * @param {hash} config - Configuration
 * @param {string} param - Param to test
 * @returns {bool} - true or will throw an exception if required
 */
function validateParameter(config, param) {
  if (config[param]) return true;
  throw new Error(`Undefined ${param} parameter`);
}

/**
 * Validate required parameters in Config
 *
 * @param {hash} config - config to test
 * @returns {bool} - true or exception
 */
function validateParameters(config) {
  const params = ['root', 'event', 'granule_meta', 'query'];
  for (const p of params) validateParameter(config, p);

  return true;
}

/**
 * Task which discovers granules by querying the CMR
 * Input payload: none
 * Output payload: Array of objects { meta: {...} } containing meta as specified in the task config
 *                 for each discovered granule
 */
module.exports = class DiscoverCmrGranulesTask extends Task {
  /**
   * Main task entrypoint
   *
   * @returns {Array} -- An array of CMR granules that need ingest
   */
  async run() {
    validateParameters(this.config);
    const query = this.config.query;
    if (query.updated_since) {
      query.updated_since = new Date(Date.now() - parseDuration(query.updated_since)).toISOString();
    }
    this.message.payload = this.message.payload || { scrollID: null };

    const { scrollID, granules } = await this.cmrGranules(
      this.config.root,
      query,
      this.message.payload.scrollID);
    const messages = this.buildMessages(granules, this.config.granule_meta, this.message.meta);
    const filtered = this.excludeFiltered(messages, this.config.filtered_granule_keys);

    // Write the messages to a DynamoDB table so we can track ingest failures
    const messagePromises = filtered.map((msg) => {
      const { granuleId, version, collection } = msg.meta;
      const params = {
        TableName: this.config.ingest_tracking_table,
        Item: {
          'granule-id': granuleId,
          'version': version,
          'collection': collection,
          'ingest-start-datetime': moment().format(),
          'message': JSON.stringify(msg)
        }
      };
      return docClient.put(params).promise();
    });

    await Promise.all(messagePromises);

    return { messages: filtered, scrollID: scrollID };
  }

  /**
   * excludeFiltered - Excludes messages that do not match one of the specified granuleFilter.
   * Allows all messages if matchingKeys is null.
   *
   * @param {Hash} messages - messages
   * @param {Hash} granuleFilter - granuleFilter
   * @returns {Hash} - Filtered messages
   */
  excludeFiltered(messages, granuleFilter) {
    /**
     * Filter Function to be used
     *
     * @returns {Hash} - Filtered messages
     */
    let filterFn = () => true;
    if (granuleFilter) {
      if (granuleFilter.filtered_granule_keys) {
        const keySet = new Set(granuleFilter.filtered_granule_keys);
        filterFn = (msg) => keySet.has(msg.meta.key);
      }
      else if (granuleFilter.filtered_granule_key_start) {
        const start = granuleFilter.filtered_granule_key_start;
        const end = granuleFilter.filtered_granule_key_end;
        filterFn = (msg) => msg.meta.key >= start && msg.meta.key <= end;
      }
    }
    return messages.filter(filterFn);
  }

  /**
   * Returns CMR granules updated after the specified date
   *
   * @param {string} root - The CMR root url (protocol and domain without path)
   * @param {Object} query - The query parameters to serialize and send to a CMR granules search
   * @returns {Array} An array of all granules matching the given query
   */
  async cmrGranules(root, query, scrollID) {
    const granules = [];
    const params = Object.assign({}, query);
    if (params.updated_since) params.sort_key = 'revision_date';
    params.scroll = 'true';
    const baseUrl = `${root}/search/granules.json`;
    const opts = { headers: { 'Client-Id': 'GitC' } };
    const url = [baseUrl, querystring.stringify(params)].join('?');
    if (scrollID) opts.headers['CMR-Scroll-Id'] = scrollID;
    log.info('Fetching:', url);
    const response = await fetch(url, opts);
    if (!response.ok) {
      throw new Error(`CMR Error ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    log.info(json);
    granules.push(...json.feed.entry);
    log.info(`scrollID:${scrollID}`,
      `cmr-scroll-id:${response.headers._headers['cmr-scroll-id']}`,
      `json.feed.entry.length:${json.feed.entry.length}`);
    const nextScrollID = (json.feed.entry.length === 0) ?
      false :
      response.headers._headers['cmr-scroll-id'];
    log.info(`nextScrollID:${nextScrollID}`);
    log.info('----TOTAL----: ', granules.length);
    return { granules: granules, scrollID: nextScrollID };
  }

  /**
   * Builds the output array for the task
   *
   * @param {Array} granules - The granules to output
   * @param {Object} opts - The granule_meta object passed to the task config
   * @param {Object} fieldValues - Field values to apply to the granule_meta (the incoming message)
   * @returns {Array} An array of meta objects for each granule created as specified
   * in the task config
   */
  buildMessages(granules, opts, fieldValues) {
    if (!opts) return granules;

    // One message per granule
    return granules.map((granule) => {
      const transaction = Object.assign({}, fieldValues);
      for (const key of Object.keys(opts)) {
        const pattern = new FieldPattern(opts[key], fieldValues);
        transaction[key] = pattern.format({ granule: granule });
      }
      const result = {
        meta: transaction
      };
      if (this.config.urls) {
        const pattern = new RegExp(this.config.urls);
        const urls = (granule.links || []).map((link) => ({
          url: link.href,
          version: granule.updated
        }));
        result.payload = urls.filter((url) => url.url.match(pattern));
      }
      return result;
    });
  }

  /**
   * Entrypoint for Lambda
   *
   * @param {Array} args - The arguments passed by AWS Lambda
   * @returns {Hash} -
   *
   *  The handler return value
   */
  static handler(...args) {
    return DiscoverCmrGranulesTask.handle(...args);
  }
};

// To use with Visual Studio Code Debugger, uncomment next block
//
//global.__isDebug = true;
//const local = require('@cumulus/common/local-helpers');
//const localTaskName = 'DiscoverCmrGranules';
//local.setupLocalRun(module.exports.handler, local.collectionMessageInput(
//  'MOPITT_DCOSMR_LL_D_STD', localTaskName));
