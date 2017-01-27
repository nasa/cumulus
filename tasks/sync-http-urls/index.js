'use strict';

const path = require('path');
const _ = require('lodash');

const log = require('gitc-common/log');
const Task = require('gitc-common/task');
const aws = require('gitc-common/aws');
const concurrency = require('gitc-common/concurrency');

exports.SIMULTANEOUS_REQUEST_LIMIT = 5;
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
  if (!lastLog || new Date() > 5000 + lastLog) {
    const suppression = intermediates > 0 ? ` (${intermediates} messages supressed)` : '';
    log.debug(`Starting: ${file.url} -> s3://${bucket}/${destKey}${suppression}`);
    intermediates = 0;
    lastLog = +new Date();
    didLog = true;
  }
  else {
    intermediates++;
  }
  await aws.syncUrl(file.url, bucket, destKey);
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
    const bucket = this.config.output.Bucket;
    const keypath = this.config.output.Key;

    const { completed, errors } = await this.syncFiles(
      this.updated,
      bucket,
      keypath,
      this.event.local);
    const isComplete = completed.length === this.updated.length;
    const completedFiles = _.map(completed, (f) => _.omit(f, ['url', 'version']));
    const completedKeys = _.map(completed, (f) => f.url + f.version);
    this.state.files = _.values(_.keyBy(this.state.files.concat(completedFiles), 'Key'));
    this.state.completed = _.uniq(this.state.completed.concat(completedKeys));
    const result = Object.assign({}, this.event);
    if (isComplete) {
      log.info('Sync is complete');
      result.payload = this.state.files;
      this.trigger('sync-completed', this.transactionKey, result);
    }
    else {
      log.info('Sync is incomplete');
      throw new Error('Incomplete');
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
    return result;
  }

  syncFiles(files, bucket, keypath, simulate = false) {
    const syncIfTimeLeft = _.partial(concurrency.unless,
                                     () => this.endsWithin(exports.TIMEOUT_TIME_MS),
                                     syncFile,
                                     bucket,
                                     keypath,
                                     simulate);
    const syncLimited = concurrency.limit(exports.SIMULTANEOUS_REQUEST_LIMIT, syncIfTimeLeft);
    return concurrency.mapTolerant(files, syncLimited);
  }

  static handler(...args) {
    return SyncHttpUrlsTask.handle(...args);
  }
};

if (process.argv[2] === 'stdin') {
  module.exports.handler({
    eventName: 'resource-urls-found',
    eventSource: 'stdin',
    config: {
      ignoredErrorStatuses: '{collection.ingest.config.ignoredErrorStatuses}',
      output: {
        Bucket: "{resources.buckets.private}",
        Key: "sources/EPSG{meta.epsg}/{meta.key}"
      }
    }
  }, {}, () => {});
}
