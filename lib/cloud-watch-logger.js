const aws = require('./aws');
const log = require('./log');

const spaceDelimited = (args) => args.map((arg) => {
  if (typeof arg === 'undefined') {
    return 'undefined';
  }
  const argStr = (typeof arg === 'string' || arg instanceof String) ? arg : JSON.stringify(arg);
  if (typeof argStr !== 'string' && !(argStr instanceof String)) { // Happens with functions
    return '[unloggable]';
  }
  if ((argStr.startsWith('[') && argStr.endsWith(']')) || argStr.indexOf(' ') === -1) {
    return argStr;
  }
  return JSON.stringify(argStr);
}).join(' ');

const BATCH_TIME_MS = 100;
const MAX_RETRIES = 5;

module.exports = class CloudWatchLogger {
  constructor(config) {
    this.group = config.logGroupName;
    this.stream = config.logStreamName;
    this.token = null;
    this.queue = [];
    this.timeout = 0;
    this.retries = 0;
    this.isPaused = false;
  }

  log(...args) {
    log.log(...args, '[cw]');
    this.queue.push({ message: spaceDelimited(args), timestamp: Date.now() });
    if (!this.isPaused) {
      this.uploadLogs();
    }
  }

  pause() {
    this.isPaused = true;
  }

  unpause() {
    this.isPaused = false;
    this.uploadLogs();
  }

  uploadLogs() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.uploadLogsImmediate(), BATCH_TIME_MS);
  }

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

  createLogStream() {
    return aws.cloudwatchlogs().createLogStream({
      logGroupName: this.group,
      logStreamName: this.stream
    }).promise();
  }

  async uploadLogsImmediate() {
    try {
      if (this.queue.length === 0) return;
      this.token = this.token || await this.getSequenceToken();

      const eventData = await aws.cloudwatchlogs().putLogEvents({
        logEvents: this.queue,
        logGroupName: this.group,
        logStreamName: this.stream,
        sequenceToken: this.token
      }).promise();
      this.token = eventData.nextSequenceToken;
      this.retries = 0;
      this.queue = [];
    }
    catch (err) {
      log.error(err, err.stack);
      if (this.retries < MAX_RETRIES) {
        this.retries++;
        this.token = err.message.split(' is: ')[1];
        log.error(`Retrying log upload (${this.retries})`);
        this.uploadLogs();
      }
    }
  }
};
