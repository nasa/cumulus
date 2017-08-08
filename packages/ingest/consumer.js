'use strict';

const aws = require('./aws');

class Consume {
  constructor(queueUrl, messageLimit = 1, timeLimit = 90) {
    this.queueUrl = queueUrl;
    this.messageLimit = messageLimit;
    this.timeLimit = timeLimit * 100;
    this.now = Date.now();
    this.endConsume = false;
  }

  async processMessage(message, fn) {
    try {
      await fn(message);
      await aws.SQS.deleteMessage(this.queueUrl, message.ReceiptHandle);
    }
    catch (e) {
      console.log(e);
    }
  }

  async processMessages(fn, messageLimit) {
    let counter = 0;
    while (!this.endConsume) {
      const messages = await aws.SQS.receiveMessage(this.queueUrl, messageLimit);
      counter += messages.length;

      if (messages.length > 0) {
        const processes = messages.map(message => this.processMessage(message, fn));
        await Promise.all(processes);
      }

      // if the function is running for more than the timeLimit, stop it
      const timeElapsed = (Date.now() - this.now);
      if (timeElapsed > this.timeLimit) {
        this.endConsume = true;
      }
    }

    return counter;
  }

  async read(fn) {
    // a get around for 10 messages at a time limit of sqs
    let messageLimit = this.messageLimit;

    let sum;
    if (messageLimit > 10) {
      const jobs = [];
      while (messageLimit > 10) {
        jobs.push(this.processMessages(fn, messageLimit));
        messageLimit -= 10;
      }

      if (messageLimit > 0) {
        jobs.push(this.processMessages(fn, messageLimit));
      }

      const results = await Promise.all(jobs);
      sum = results.reduce((s, v) => s + v, 0);
    }
    else if (messageLimit > 40) {
      throw new Error('Message limit must be less than 40');
    }
    sum = await this.processMessages(fn, messageLimit);

    console.log(`${sum} messages processed from ${this.queueUrl}`);
    return sum;
  }
}

module.exports.Consume = Consume;
