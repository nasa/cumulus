'use strict';

const path = require('path');
const _ = require('lodash');
const request = require('request');
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

/**
 * Synchronizes a single URL to S3, respecting cookies and redirects, with optional authorization
 * @param {String} url The URL to sync
 * @param {String} bucket The bucket to upload to
 * @param {String} key The S3 key to upload to
 * @param {Object} auth An object with username / password keys corresponding to basic auth, or null
 */
const syncUrl = (url, bucket, key, auth) =>
  new Promise((resolve, reject) => {
    const options = {
      url: url,
      jar: true,
      encoding: null // Needed?
    };
    if (auth) {
      options.auth = {
        user: auth.username,
        pass: auth.password,
        sendImmediately: false
      };
    }

    request(options, (error, response, body) => {
      if (error) {
        return reject(error);
      }

      aws.s3().putObject({
        Bucket: bucket,
        Key: key,
        ContentType: response.headers['content-type'],
        ContentLength: response.headers['content-length'],
        Body: body
      }, (err) => {
        if (err) return reject(err);
        return resolve();
      });
    });
  });


/**
 * lastLogTime and suppressedMessagesCount are used to store state in the
 * conditionallyLogSyncFileMessage function.
 */
let lastLogTime = 0;
let suppressedMessagesCount = 0;

/**
 * Log a message if nothing has been logged in the last 5 seconds or if alwaysLog is true.
 *
 * Note: This uses the module-level "lastLogTime" and "suppressedMessagesCount"
 *       to store state.
 *
 * @param  {string} url - The URL being downloaded
 * @param  {string} bucket - The S3 bucket the file is being synced to
 * @param  {string} destKey - The S3 key the file is being synced to
 * @param  {boolean} alwaysLog - A flag to always trigger logging
 * @returns {boolean} Whether a log message was displayed
 */
function conditionallyLogSyncFileMessage(url, bucket, destKey, alwaysLog) {
  const millisecondsSinceLastLogTime = Date.now() - lastLogTime;

  if (alwaysLog || millisecondsSinceLastLogTime > 5000) {
    let suppressionSuffix = '';
    if (suppressedMessagesCount > 0) {
      suppressionSuffix = ` (${suppressedMessagesCount} messages supressed)`;
    }

    log.debug(`Starting: ${url} -> s3://${bucket}/${destKey}${suppressionSuffix}`);

    suppressedMessagesCount = 0;
    lastLogTime = Date.now();
    return true;
  }
  else {
    suppressedMessagesCount++;
    return false;
  }
}

const syncFile = async (bucket, keypath, simulate, auth, file) => {
  try {
    const destKey = path.join(keypath, file.name || path.basename(file.Key || file.url));

    const didLog = conditionallyLogSyncFileMessage(file.url, bucket, destKey, simulate);

    if (simulate) log.warn('Simulated call');
    else await syncUrl(file.url, bucket, destKey, auth);

    if (didLog) log.debug(`Completed: ${file.url}`);

    return Object.assign({ Bucket: bucket, Key: destKey }, file);
  }
  catch (e) {
    log.info(`Exception in syncFile: ${e.stack}`);
    log.info(`keypath: ${keypath}`);
    log.info(`file: ${JSON.stringify(file, null, 2)}`);
    throw e;
  }
};

module.exports = class SyncHttpUrlsTask extends Task {
  run() {
    return this.limitConnectionsFromConfig(() => this.runWithLimitedConnections());
  }

  async runWithLimitedConnections() {
    // Load existing state
    let state;
    if (!this.config.stateless) {
      state = await this.source.loadState(this.constructor.name);
    }
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
    if (!this.config.stateless) {
      this.source.saveState(this.constructor.name, state);
    }

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
                                     simulate,
                                     this.config.auth);
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
