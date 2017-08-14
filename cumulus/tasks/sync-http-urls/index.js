'use strict';

const path = require('path');
const _ = require('lodash');

const log = require('@cumulus/common/log');
const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const concurrency = require('@cumulus/common/concurrency');
const local = require('@cumulus/common/local-helpers');
const errorTypes = require('@cumulus/common/errors');


const TIMEOUT_TIME_MS = 20 * 1000;

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
  run() {
    return this.limitConnectionsFromConfig(() => this.runWithLimitedConnections());
  }

  async runWithLimitedConnections() {
    // Load existing state
    let state = await this.source.loadState(this.constructor.name);
    if (!state) {
      state = { files: [], completed: [] };
    }

    // Figure out what new / modified files are available
    const updated = updatedFiles(state.completed, this.message.payload);
    if (updated.length === 0) {
      log.info('No updates to synced files. Sync is not needed.');
      await this.source.complete();
      throw new errorTypes.NotNeededError();
    }

    const bucket = this.config.output.bucket;
    const keypath = this.config.output.key_prefix;

    // Synchronize the files
    const { completed, errors } = await this.syncFiles(
      updated,
      bucket,
      keypath,
      local.isLocal);

    // Determine / save the new state
    const isComplete = completed.length === updated.length;
    const completedFiles = _.map(completed, (f) => _.omit(f, ['url', 'version']));
    const completedKeys = _.map(completed, (f) => f.url + f.version);
    state.files = _.values(_.keyBy(state.files.concat(completedFiles), 'Key'));
    state.completed = _.uniq(state.completed.concat(completedKeys));
    let result = [];
    if (isComplete) {
      log.info('Sync is complete');
      result = state.files;
    }
    else {
      log.info('Sync is incomplete');
    }
    this.source.saveState(this.constructor.name, state);

    // Terminate correctly
    if (errors) {
      if (this.config.ignoredErrorStatuses) {
        const ignoredErrors = this.config.ignoredErrorStatuses.split(',');
        const thrownErrors = _.reject(errors, (error) =>
          _.some(ignoredErrors, (ignored) => error.reason === `HTTP Error ${ignored}`));
        if (thrownErrors.length > 0) {
          throw new errorTypes.RemoteResourceError(JSON.stringify(thrownErrors));
        }
      }
      else {
        throw new errorTypes.RemoteResourceError(JSON.stringify(errors));
      }
    }

    if (!isComplete) {
      throw new errorTypes.IncompleteError();
    }
    return result;
  }

  syncFiles(files, bucket, keypath, simulate = false) {
    const syncIfTimeLeft = _.partial(concurrency.unless,
                                     () => this.endsWithin(TIMEOUT_TIME_MS),
                                     syncFile,
                                     bucket,
                                     keypath,
                                     simulate);
    const syncLimited = concurrency.limit(this.config.connections || 5, syncIfTimeLeft);
    return concurrency.mapTolerant(files, syncLimited);
  }

  /**
   * Entrypoint for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return SyncHttpUrlsTask.handle(...args);
  }
};

local.setupLocalRun(
  module.exports.handler,
  () => ({ ingest_meta: { message_source: 'stdin', task: 'SyncHttpUrls' } }));
