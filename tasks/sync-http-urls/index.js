'use strict';

const path = require('path');
const _ = require('lodash');

const log = require('gitc-common/log');
const Task = require('gitc-common/task');
const aws = require('gitc-common/aws');
const concurrency = require('gitc-common/concurrency');

exports.SIMULTANEOUS_REQUEST_LIMIT = 10;
exports.TIMEOUT_TIME_MS = 20 * 1000;

const updatedFiles = (existing, updates) => {
  const toKey = (file) => path.basename(file.key || file.url) + file.version;
  const keyedUpdates = _.keyBy(updates.urls, toKey);
  const existingKeys = existing.files.map(toKey);
  return _.values(_.omit(keyedUpdates, existingKeys));
};

const syncFile = async (bucket, keypath, file) => {
  const destKey = path.join(keypath, file.name || path.basename(file.key || file.url));
  log.debug(`Starting: ${file.url} -> s3://${bucket}/${destKey}`);
  await aws.syncUrl(file.url, bucket, destKey);
  return Object.assign({ bucket: bucket, key: destKey }, _.omit(file, ['url']));
};

module.exports = class SyncHttpUrlsTask extends Task {
  shouldRun() {
    if (!this.state) {
      this.state = Object.assign({}, this.event, { files: [] });
    }

    this.updated = updatedFiles(this.state, this.event);
    return this.updated.length !== 0;
  }

  async run() {
    const bucket = this.config.output.Bucket;
    const keypath = this.config.output.Key;

    const { completed, errors } = await this.syncFiles(this.updated, bucket, keypath);
    const isComplete = completed.length === this.updated.length;
    this.state.files = _.values(_.keyBy(this.state.files.concat(completed), (f) => f.key));
    if (isComplete) {
      log.info('Sync is complete');
      const eventData = Object.assign({ files: this.state.files },
                                      _.pick(this.event, ['transaction', 'config']));
      this.trigger('sync-completed', this.transactionKey, eventData);
    }
    else {
      log.info('Sync is incomplete');
    }
    if (errors) {
      throw errors;
    }
    return this.state.urls.length;
  }

  syncFiles(files, bucket, keypath) {
    const syncIfTimeLeft = _.partial(concurrency.unless,
                                     () => this.endsWithin(exports.TIMEOUT_TIME_MS),
                                     syncFile,
                                     bucket,
                                     keypath);
    const syncLimited = concurrency.limit(exports.SIMULTANEOUS_REQUEST_LIMIT, syncIfTimeLeft);
    return concurrency.mapTolerant(files, syncLimited);
  }

  static handler(...args) {
    return SyncHttpUrlsTask.handle(...args);
  }
};

if (process.argv[2] === 'stdin') {
  module.exports.handler({ eventName: 'resource-urls-found', eventSource: 'stdin' }, {}, () => {});
}
