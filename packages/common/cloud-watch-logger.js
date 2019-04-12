'use strict';

const isString = require('lodash.isstring');

const aws = require('./aws');
const log = require('./log');

/**
 * Takes a list of logging arguments and returns them as space-delimited fields
 * Arguments inside square brackets are left un-changed in the output, allowing tagged logging
 * undefined arguments are represented by the literal "undefined"
 * JSON-serializeable objects are returned as their JSON serialization
 * Anything else is represented by "[unloggable]"
 * @param {Array} args - The list of arguments to log
 * @returns {string} - The args, space-delimited as above
 */
const spaceDelimited = (args) => args.map((arg) => {
  if (arg === undefined) return 'undefined';

  const argStr = isString(arg) ? arg : JSON.stringify(arg);
  if (!isString(argStr)) { // Happens with functions
    return '[unloggable]';
  }
  if ((argStr.startsWith('[') && argStr.endsWith(']')) || !argStr.includes(' ')) {
    return argStr;
  }
  return JSON.stringify(argStr);
}).join(' ');

const BATCH_TIME_MS = 100; // The number of ms to wait for new logs before sending current logs

const MAX_RETRIES = 5; // The maximum number of failures to tolerate in sending logs

/**
 * Class representing a logger which sends its logs to CloudWatch
 */
module.exports = class CloudWatchLogger {
  /**
   * @param {Object} config - An object with two params for CloudWatch: logGroupName
   *                          and logStreamName
   */
  constructor(config) {
    this.group = config.logGroupName;
    this.stream = config.logStreamName;
    this.token = null;
    this.queue = [];
    this.timeout = 0;
    this.retries = 0;
    this.isPaused = false;
  }

  /**
   * Logs the given arguments
   * @param {*} args The arguments to log
   */
  log(...args) {
    log.log(...args, '[cw]');
    this.queue.push({ message: spaceDelimited(args), timestamp: Date.now() });
    if (!this.isPaused) {
      this.uploadLogs();
    }
  }

  /**
   * Stops sending further logs, queuing them instead
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Continues sending logs, including any queued logs
   */
  unpause() {
    this.isPaused = false;
    this.uploadLogs();
  }

  /**
   * Sets a timeout to upload logs if no more are encountered
   */
  uploadLogs() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.uploadLogsImmediate(), BATCH_TIME_MS);
  }

  /**
   * Gets the sequence token necessary to send logs to CloudWatch
   *
   * @param {boolean} retried - Internally used to track if the stream needs creation
   * @returns {*} The next sequence token
   */
  async getSequenceToken(retried = false) {
    const streams = await aws.cloudwatchlogs().describeLogStreams({
      logGroupName: this.group,
      limit: 1,
      logStreamNamePrefix: this.stream
    }).promise();
    if (streams.logStreams.length === 0 && !retried) {
      await this.createLogStream();
      return this.getSequenceToken(true);
    }
    return streams.logStreams[0].uploadSequenceToken;
  }

  /**
   * Creates the log stream to log to
   *
   * @returns {Promise} resolves when the log stream has been created
   */
  createLogStream() {
    return aws.cloudwatchlogs().createLogStream({
      logGroupName: this.group,
      logStreamName: this.stream
    }).promise();
  }

  /**
   * Uploads all logs in the queue without waiting for a timeout
   */
  async uploadLogsImmediate() {
    try {
      if (this.queue.length === 0) return;
      this.token = this.token || await this.getSequenceToken();

      const messageData = await aws.cloudwatchlogs().putLogMessages({
        logMessages: this.queue,
        logGroupName: this.group,
        logStreamName: this.stream,
        sequenceToken: this.token
      }).promise();
      this.token = messageData.nextSequenceToken;
      this.retries = 0;
      this.queue = [];
    } catch (err) {
      log.error(err, err.stack);
      if (this.retries < MAX_RETRIES) {
        this.retries += 1;
        this.token = err.message.split(' is: ')[1];
        log.error(`Retrying log upload (${this.retries})`);
        this.uploadLogs();
      }
    }
  }
};
