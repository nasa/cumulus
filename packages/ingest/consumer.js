'use strict';

const { log, util: { deprecate } } = require('@cumulus/common');
const { receiveSQSMessages, deleteSQSMessage } = require('@cumulus/common/aws');

class Consume {
  // DEPRECATED: Consume has been superseded by Consumer
  constructor(queueUrl, messageLimit = 1, timeLimit = 90) {
    deprecate('@cumulus/ingest/consumer.Consume', '1.10.3', '@cumulus/ingest/consumer.Consumer');
    this.queueUrl = queueUrl;
    this.messageLimit = messageLimit;
    this.timeLimit = timeLimit * 100;
    this.now = Date.now();
    this.endConsume = false;
  }

  async processMessage(message, fn) {
    try {
      await fn(message);
      await deleteSQSMessage(this.queueUrl, message.ReceiptHandle);
    }
    catch (e) {
      log.error(e);
    }
  }

  async processMessages(fn, messageLimit) {
    let counter = 0;
    let remainingMessageLimit = messageLimit;
    const originalMessageLimit = remainingMessageLimit;

    /* eslint-disable no-await-in-loop */
    while (!this.endConsume) {
      const messages = await receiveSQSMessages(
        this.queueUrl,
        { numOfMessages: messageLimit }
      );
      counter += messages.length;

      if (messages.length > 0) {
        const processes = messages.map((message) => this.processMessage(message, fn));
        await Promise.all(processes);
      }

      // if the function is running for more than the timeLimit, stop it
      const timeElapsed = (Date.now() - this.now);
      if (timeElapsed > this.timeLimit || counter >= originalMessageLimit) {
        this.endConsume = true;
      }
      // Only request up to the original messageLimit messages on subsequent calls to
      // `receiveSQSMessages`
      remainingMessageLimit -= messages.length;
    }
    /* eslint-enable no-await-in-loop */

    return counter;
  }

  async read(fn) {
    // a get around for 10 messages at a time limit of sqs
    let messageLimit = this.messageLimit;

    let sum;
    if (messageLimit > 40) {
      throw new Error('Message limit must be less than 40');
    }
    else if (messageLimit > 10) {
      const jobs = [];
      while (messageLimit > 10) {
        jobs.push(this.processMessages(fn, 10));
        messageLimit -= 10;
      }

      if (messageLimit > 0) {
        jobs.push(this.processMessages(fn, messageLimit));
      }

      const results = await Promise.all(jobs);
      sum = results.reduce((s, v) => s + v, 0);
    }

    sum = await this.processMessages(fn, messageLimit);

    log.info(`${sum} messages processed from ${this.queueUrl}`);
    return sum;
  }
}

class Consumer {
  constructor(queueUrl, messageLimit = 1, timeLimit = 90) {
    this.queueUrl = queueUrl;
    this.messageLimit = messageLimit;
    this.timeLimit = timeLimit * 1000;
    this.now = Date.now();
    this.timeLapsed = false;
  }

  async processMessage(message, fn) {
    try {
      await fn(message);
      await deleteSQSMessage(this.queueUrl, message.ReceiptHandle);
      return 1;
    }
    catch (e) {
      log.error(e);
      return 0;
    }
  }

  async processMessages(fn, messageLimit) {
    if (messageLimit > 10) throw new Error(`Cannot process more than 10 messages per function call. Received limit: ${messageLimit}`);

    let counter = 0;
    const messages = await receiveSQSMessages(
      this.queueUrl,
      { numOfMessages: messageLimit }
    );
    if (messages.length > 0) {
      const processes = messages.map((message) => this.processMessage(message, fn));
      const results = await Promise.all(processes);
      counter = results.reduce((s, v) => s + v, 0);
    }
    return counter;
  }

  async consume(fn) {
    let messageLimit = this.messageLimit;
    log.info(`Attempting to process up to ${messageLimit} messages...`);

    let sum = 0;
    /* eslint-disable no-await-in-loop */
    // Only request up to the original messageLimit messages on subsequent `processMessages` calls
    while (messageLimit > 0 && !this.timeLapsed) {
      let results;
      if (messageLimit > 10) {
        results = await this.processMessages(fn, 10);
        messageLimit -= 10;
      }
      else if (messageLimit > 0) {
        results = await this.processMessages(fn, messageLimit);
        messageLimit -= messageLimit;
      }
      sum += results;
      // if the function is running for longer than the timeLimit, stop it
      const timeSpent = (Date.now() - this.now);
      if (timeSpent > this.timeLimit) {
        this.timeLapsed = true;
        log.warn(`${this.timeLimit / 1000}-second time limit reached, exiting...`);
      }
    }
    /* eslint-enable no-await-in-loop */

    log.info(`${sum} messages successfully processed from ${this.queueUrl}`);
    return sum;
  }
}

module.exports = {
  Consume,
  Consumer
};
