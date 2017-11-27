'use strict';

const parseDuration = require('parse-duration');
const fetch = require('node-fetch');
const log = require('@cumulus/common/log');
const Task = require('@cumulus/common/task');
const FieldPattern = require('@cumulus/common/field-pattern');
const docClient = require('@cumulus/common/aws').dynamodbDocClient;
const querystring = require('querystring');
const moment = require('moment');

/**
 * Task which discovers granules by querying the CMR
 * Input payload: none
 * Output payload: Array of objects { meta: {...} } containing meta as specified in the task config
 *                 for each discovered granule
 */
module.exports = class DiscoverCmrGranulesTask extends Task {
  /**
   * Main task entrypoint
   * @return An array of CMR granules that need ingest
   */
  async run() {
    const query = this.config.query || { page_size: 100 };
    if (query.updated_since) {
      query.updated_since = new Date(Date.now() - parseDuration(query.updated_since)).toISOString();
    }
    this.message.payload = this.message.payload || { scrollID: null };

    const { scrollID, granules } = await this.cmrGranules(
      this.config.root,
      query,
      this.message.payload.scrollID);
    log.debug(`using scrollID: ${scrollID}`);
    const messages = this.buildMessages(granules, this.config.granule_meta, this.message.meta);
    const filtered = this.excludeFiltered(messages, this.config.filtered_granule_keys);
    // Write the messages to a DynamoDB table so we can track ingest failures
    filterd.forEach(message => {
      const { concept_id, granuleId, collection } = message;
      const params = {
        TableName: this.config.ingest_tracking_table,
        Item: {
          'granule-id': granuleId,
          'cmr-concept-id': concept_id,
          'collection': collection,
          'ingest-start-datetime': moment().format(),
          'message': JSON.stringify(message)
        }
      };

      docClient.put(params, (err, _) => {
        if (err) {
          throw err;
        }
      });
    });

    return { messages: filtered, scrollID: scrollID };
  }

  /**
   * excludeFiltered - Excludes messages that do not match one of the specified granuleFilter.
   * Allows all messages if matchingKeys is null.
   */
  excludeFiltered(messages, granuleFilter) {
    let filterFn = () => true;
    if (granuleFilter) {
      if (granuleFilter.filtered_granule_keys) {
        const keySet = new Set(granuleFilter.filtered_granule_keys);
        filterFn = msg => keySet.has(msg.meta.key);
      }
      else if (granuleFilter.filtered_granule_key_start) {
        const start = granuleFilter.filtered_granule_key_start;
        const end = granuleFilter.filtered_granule_key_end;
        filterFn = msg => msg.meta.key >= start && msg.meta.key <= end;
      }
    }
    return messages.filter(filterFn);
  }

  /**
   * Returns CMR granules updated after the specified date
   * @param {string} root - The CMR root url (protocol and domain without path)
   * @param {object} query - The query parameters to serialize and send to a CMR granules search
   * @return An array of all granules matching the given query
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
   * @param {array} granules - The granules to output
   * @param {object} opts - The granule_meta object passed to the task config
   * @param {object} fieldValues - Field values to apply to the granule_meta (the incoming message)
   * @return An array of meta objects for each granule created as specified in the task config
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
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return DiscoverCmrGranulesTask.handle(...args);
  }
};

// To run a small test:
// node discover-cmr-granules local

const local = require('@cumulus/common/local-helpers');
const localTaskName = 'DiscoverCmrGranules';
local.setupLocalRun(module.exports.handler,
                    local.collectionMessageInput('MOPITT_DCOSMR_LL_D_STD', localTaskName));
