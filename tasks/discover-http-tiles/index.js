'use strict';

const ApacheIndexTileCrawler = require('./apache-index-tile-crawler');

const log = require('gitc-common/log');
const Task = require('gitc-common/task');
const FieldPattern = require('gitc-common/field-pattern');
const _ = require('lodash');

const endpointsToCrawlers = {
  'apache-index': ApacheIndexTileCrawler
};

module.exports = class DiscoverHttpTilesTask extends Task {
  run() {
    const config = this.config;
    const event = this.event;
    const root = this.config.root;

    const CrawlerClass = endpointsToCrawlers[config.type];
    const crawler = new CrawlerClass(event.product, root, new FieldPattern(config.match));

    return new Promise((resolve) => {
      crawler.on('complete', (resources) => {
        const complete = this.excludeIncomplete(resources, config.required, event);
        const withMeta = this.addFileMeta(complete, config.file, event);
        const events = this.buildEvents(withMeta, config.groupBy, config.addMeta, event);

        for (const event of events) {
          this.trigger('resource-urls-found', event.transaction.key, event);
        }
        resolve(resources.length);
      });
      crawler.crawl();
    });
  }

  excludeIncomplete(resources, opts, fieldValues) {
    if (!opts) return resources;
    let result = resources;
    for (const required of opts) {
      const pattern = new FieldPattern(required.group, fieldValues);
      const groups = _.values(_.groupBy(result, (r) => pattern.format(r.fields)));
      const { prop, values } = required;
      const passing = [];
      for (const group of groups) {
        const propValues = group.map((f) => f.fields[prop]);
        if (_.intersection(propValues, values).length === values.length) {
          passing.push.apply(passing, group); // eslint-disable-line prefer-spread
        }
        else {
          log.info('Excluding incomplete values', group);
        }
      }
      result = passing;
    }

    return result;
  }

  addFileMeta(resources, opts, fieldValues) {
    if (!opts) return resources;

    for (const key of Object.keys(opts)) {
      const pattern = new FieldPattern(opts[key], fieldValues);
      for (const resource of resources) {
        resource[key] = pattern.format(resource.fields);
      }
    }
    return resources;
  }

  buildEvents(resources, grouping, opts, fieldValues) {
    if (!opts) return resources;

    // Group everything by transaction key
    const pattern = new FieldPattern(grouping, fieldValues);
    const groups = _.values(_.groupBy(resources, (r) => pattern.format({ match: r.fields })));

    // Add transaction fields
    return groups.map((group) => {
      const transaction = Object.assign({}, this.event.transaction);
      for (const key of Object.keys(opts)) {
        const pattern = new FieldPattern(opts[key], fieldValues);
        transaction[key] = pattern.format({ match: group[0].fields });
      }
      return Object.assign({}, this.event, {
        transaction: transaction,
        meta: transaction,
        payload: group.map((resource) => _.omit(resource, ['fields']))
      });
    });
  }

  static handler(...args) {
    return DiscoverHttpTilesTask.handle(...args);
  }
};

// To run a small test:
// node --harmony index.js local
const local = require('gitc-common/local-helpers');
local.setupLocalRun(module.exports.handler, local.collectionEventInput('VNGCR_SQD_C1', (input) => {
  const result = {
    config: input.collection.ingest.config
  };
  result.config.root += 'VNGCR_SQD_C1_r00c01/';
  return result;
}));
