'use strict';

const parseDuration = require('parse-duration');
const fetch = require('node-fetch');
const log = require('gitc-common/log');
const Task = require('gitc-common/task');
const FieldPattern = require('gitc-common/field-pattern');

const PAGE_SIZE = 2000;

module.exports = class DiscoverCmrGranulesTask extends Task {
  async run() {
    const since = new Date(Date.now() - parseDuration(this.config.since)).toISOString();
    const conceptId = this.event.meta.concept_id;
    const granules = await this.cmrGranules(this.config.root, since, conceptId);
    const events = this.buildEvents(granules, this.config.addMeta, this.event.meta);

    const result = [];
    for (const event of events) {
      result.push(Object.assign({}, this.event, event));
      this.trigger(this.config.event, event.meta.key, Object.assign({}, this.event, event));
    }
    return result;
  }

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

  buildEvents(granules, opts, fieldValues) {
    if (!opts) return granules;

    // One event per granule
    return granules.map((granule) => {
      const transaction = Object.assign({}, fieldValues);
      for (const key of Object.keys(opts)) {
        const pattern = new FieldPattern(opts[key], fieldValues);
        transaction[key] = pattern.format({ granule: granule });
      }
      return {
        meta: transaction,
        transaction: transaction
      };
    });
  }

  static handler(...args) {
    return DiscoverCmrGranulesTask.handle(...args);
  }
};

// To run a small test:
// node discover-cmr-granules local

const local = require('gitc-common/local-helpers');
local.setupLocalRun(module.exports.handler, local.collectionEventInput('MOPITT_DCOSMR_LL_D_STD'));
