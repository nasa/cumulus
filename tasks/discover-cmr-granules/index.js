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
    const conceptId = this.event.transaction.concept_id;
    const granules = await this.cmrGranules(this.config.root, since, conceptId);
    const events = this.buildEvents(granules, this.config.transaction, this.event.transaction);

    for (const event of events) {
      this.trigger(this.config.event, event.transaction.key, event);
    }
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
        transaction[key] = pattern.format(granule);
      }
      return {
        config: this.event.config,
        transaction: transaction
      };
    });
  }

  static handler(...args) {
    return DiscoverCmrGranulesTask.handle(...args);
  }
};

// To run a small test:
// node discover-cmr-granules local some-test-bucket
const fs = require('fs');

if (process.argv[2] === 'local') {
  const group = JSON.parse(fs.readFileSync('../config/products.json'))[1];
  module.exports.handler(
    {
      config: group.tasks,
      transaction: Object.assign(
        {
          bucket: process.argv[3],
          config_bucket: `${process.argv[3]}-deploy`,
          mrf_bucket: `${process.argv[3]}-mrfs`
        },
        group.triggers[0].transactions[0]
      )
    },
    {},
    () => {});
}
