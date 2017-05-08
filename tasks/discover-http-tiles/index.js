'use strict';

const ApacheIndexTileCrawler = require('./apache-index-tile-crawler');

const log = require('ingest-common/log');
const Task = require('ingest-common/task');
const FieldPattern = require('ingest-common/field-pattern');
const _ = require('lodash');

const endpointsToCrawlers = {
  'apache-index': ApacheIndexTileCrawler
};

module.exports = class DiscoverHttpTilesTask extends Task {
  run() {
    return this.limitConnectionsFromConfig(() => this.runWithLimitedConnections());
  }

  runWithLimitedConnections() {
    const config = this.config;
    const message = this.message;
    const root = this.config.root;

    const CrawlerClass = endpointsToCrawlers[config.type];
    const pattern = new FieldPattern(config.match);
    const crawler = new CrawlerClass(root, pattern, config.connections || 10);
    log.info(config);

    return new Promise((resolve) => {
      crawler.on('complete', (resources) => {
        const complete = this.excludeIncomplete(resources, config.required, message);
        const withMeta = this.addFileMeta(complete, config.file, message);
        const messages = this.buildMessages(withMeta, config.group_by, config.group_meta, message);
        resolve(messages);
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

  buildMessages(resources, grouping, opts, fieldValues) {
    // Group everything
    const pattern = new FieldPattern(grouping, fieldValues);
    const groups = _.values(_.groupBy(resources, (r) => pattern.format({ match: r.fields })));

    // Add envelope fields
    return groups.map((group) => {
      const meta = {};
      for (const key of Object.keys(opts)) {
        const pattern = new FieldPattern(opts[key], fieldValues);
        meta[key] = pattern.format({ match: group[0].fields });
      }
      return {
        meta: meta,
        payload: group.map((resource) => _.omit(resource, ['fields']))
      };
    });
  }

  /**
   * Entrypoint for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return DiscoverHttpTilesTask.handle(...args);
  }
};

// To run a small test:
// node --harmony index.js local
const local = require('ingest-common/local-helpers');
const localTaskName = 'DiscoverHttpTiles';
local.setupLocalRun(
  module.exports.handler,
  local.collectionMessageInput('VNGCR_SQD_C1', localTaskName, (input) => {
    const config = input.workflow_config_template[localTaskName];
    config.root += 'VNGCR_SQD_C1_r00c01/';
    delete config.connections;
    return null;
  }));
