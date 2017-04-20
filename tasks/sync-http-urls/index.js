'use strict';

const path = require('path');
const _ = require('lodash');

const log = require('gitc-common/log');
const Task = require('gitc-common/task');
const aws = require('gitc-common/aws');
const concurrency = require('gitc-common/concurrency');
const local = require('gitc-common/local-helpers');
const errors = require('gitc-common/errors');


exports.TIMEOUT_TIME_MS = 20 * 1000;

const updatedFiles = (existingKeys, updates) => {
  const toKey = (file) => file.url + file.version;
  const keyedUpdates = _.keyBy(updates, toKey);

  return _.values(_.omit(keyedUpdates, existingKeys));
};

let lastLog = null;
let intermediates = 0;
const syncFile = async (bucket, keypath, simulate, file) => {
  const destKey = path.join(keypath, file.name || path.basename(file.key || file.url));
  let didLog = false;
  if (!lastLog || new Date() > 5000 + lastLog || simulate) {
    const suppression = intermediates > 0 ? ` (${intermediates} messages supressed)` : '';
    log.debug(`Starting: ${file.url} -> s3://${bucket}/${destKey}${suppression}`);
    intermediates = 0;
    lastLog = +new Date();
    didLog = true;
  }
  else {
    intermediates++;
  }
  if (simulate) {
    log.warn('Simulated call');
  }
  else {
    await aws.syncUrl(file.url, bucket, destKey);
  }
  if (didLog) {
    log.debug(`Completed: ${file.url}`);
  }
  return Object.assign({ Bucket: bucket, Key: destKey }, file);
};

module.exports = class SyncHttpUrlsTask extends Task {
  shouldRun() {
    if (!this.state) {
      this.state = { files: [], completed: [] };
    }

    this.updated = updatedFiles(this.state.completed, this.event.payload);
    return this.updated.length !== 0;
  }

  async run() {
    const bucket = this.config.output.bucket;
    const keypath = this.config.output.key_prefix;
    const { completed, errors } = await this.syncFiles(
      this.updated,
      bucket,
      keypath,
      local.isLocal);
    const isComplete = completed.length === this.updated.length;
    const completedFiles = _.map(completed, (f) => _.omit(f, ['url', 'version']));
    const completedKeys = _.map(completed, (f) => f.url + f.version);
    this.state.files = _.values(_.keyBy(this.state.files.concat(completedFiles), 'Key'));
    this.state.completed = _.uniq(this.state.completed.concat(completedKeys));
    let result = [];
    if (isComplete) {
      log.info('Sync is complete');
      result = this.state.files;
    }
    else {
      log.info('Sync is incomplete');
    }
    if (errors) {
      if (this.config.ignoredErrorStatuses) {
        const ignoredErrors = this.config.ignoredErrorStatuses.split(',');
        const thrownErrors = _.reject(errors, (error) =>
          _.some(ignoredErrors, (ignored) => error.reason === `HTTP Error ${ignored}`));
        if (thrownErrors.length > 0) {
          throw JSON.stringify(thrownErrors);
        }
      }
      else {
        throw JSON.stringify(errors);
      }
    }
    if (!isComplete) {
      throw new errors.IncompleteError();
    }
    return result;
  }

  syncFiles(files, bucket, keypath, simulate = false) {
    const syncIfTimeLeft = _.partial(concurrency.unless,
                                     () => this.endsWithin(exports.TIMEOUT_TIME_MS),
                                     syncFile,
                                     bucket,
                                     keypath,
                                     simulate);
    const syncLimited = concurrency.limit(this.config.connections || 5, syncIfTimeLeft);
    return concurrency.mapTolerant(files, syncLimited);
  }

  static handler(...args) {
    return SyncHttpUrlsTask.handle(...args);
  }
};

local.setupLocalRun(
  module.exports.handler,
  () => ({ ingest_meta: { event_source: 'stdin', task: 'SyncHttpUrls' } }));
