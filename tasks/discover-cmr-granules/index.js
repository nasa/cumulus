'use strict';

const parseDuration = require('parse-duration');
const fetch = require('node-fetch');
const log = require('gitc-common/log');
const Task = require('gitc-common/task');
const FieldPattern = require('gitc-common/field-pattern');

const PAGE_SIZE = 2000;

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
    const since = new Date(Date.now() - parseDuration(this.config.since)).toISOString();
    const conceptId = this.message.meta.concept_id;
    const granules = await this.cmrGranules(this.config.root, since, conceptId);
    return this.buildMessages(granules, this.config.granule_meta, this.message.meta);
  }

  /**
   * Returns CMR granules updated after the specified date
   * @param {string} root - The CMR root url (protocol and domain without path)
   * @param {string} since - The ISO date/time of the earliest update date to return
   * @param {string} id - The collection id
   * @return An array of all granules updated after the specified date
   */
  async cmrGranules(root, since, id) {
    const granules = [];
    const url = `${root}/search/granules.json?updated_since=${since}&collection_concept_id=${id}&page_size=${PAGE_SIZE}&sort_key=revision_date&page_num=`;
    const opts = { headers: { 'Client-Id': 'GitC' } };
    let done = false;
    let page = 1;
    while (!done) {
      log.info('Fetching:', url + page);
      const response = await fetch(url + page, opts);
      if (!response.ok) {
        throw new Error(`CMR Error ${response.status} ${response.statusText}`);
      }
      const json = await response.json();
      granules.push(...json.feed.entry);
      const hits = parseInt(response.headers.get('CMR-Hits'), 10);
      if (page === 1) log.info(`CMR Granule count: ${hits}`);
      done = hits <= page * PAGE_SIZE;
      page++;
    }
    return granules;
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
      return {
        meta: transaction
      };
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

const local = require('gitc-common/local-helpers');
const localTaskName = 'DiscoverCmrGranules';
local.setupLocalRun(module.exports.handler,
                    local.collectionMessageInput('MOPITT_DCOSMR_LL_D_STD', localTaskName));
