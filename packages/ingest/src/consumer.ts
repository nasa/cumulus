import { receiveSQSMessages, SQSMessage } from '@cumulus/aws-client/SQS';
import * as sqs from '@cumulus/aws-client/SQS';
import { ExecutionAlreadyExists } from '@cumulus/aws-client/StepFunctions';
import Logger from '@cumulus/logger';

export type MessageConsumerFunction = (queueUrl: string, message: SQSMessage) => Promise<void>;

const log = new Logger({ sender: '@cumulus/ingest/consumer' });
export interface ConsumerConstructorParams {
  queueUrl: string,
  messageLimit?: number,
  timeRemainingFunc?: () => number,
  visibilityTimeout: number,
  deleteProcessedMessage?: boolean,
  rateLimitPerSecond?: number;
}

export class Consumer {
  private readonly deleteProcessedMessage: boolean;
  private readonly messageLimit: number;
  private readonly queueUrl: string;
  private readonly timeRemainingFunc?: () => number;
  private readonly visibilityTimeout: number;
  private readonly rateLimitPerSecond?: number;

  constructor({
    queueUrl,
    messageLimit = 1,
    timeRemainingFunc,
    visibilityTimeout,
    deleteProcessedMessage = true,
    rateLimitPerSecond = 5,
  }: ConsumerConstructorParams) {
    this.queueUrl = queueUrl;
    this.messageLimit = messageLimit;
    this.visibilityTimeout = visibilityTimeout;
    this.timeRemainingFunc = timeRemainingFunc;
    this.deleteProcessedMessage = deleteProcessedMessage;
    this.rateLimitPerSecond = rateLimitPerSecond;
  }

  private async processMessage(
    message: SQSMessage,
    fn: MessageConsumerFunction
  ): Promise<0 | 1> {
    try {
      await fn(this.queueUrl, message);
      if (this.deleteProcessedMessage) {
        await sqs.deleteSQSMessage(this.queueUrl, message.ReceiptHandle);
      }
      return 1;
    } catch (error) {
      if (error instanceof ExecutionAlreadyExists) {
        log.debug('Deleting message for execution that already exists...');
        await sqs.deleteSQSMessage(this.queueUrl, message.ReceiptHandle);
        log.debug('Completed deleting message.');
        return 1;
      }
      log.error(error);
      return 0;
    }
  }

  private async processMessages(
    fn: MessageConsumerFunction,
    messageLimit: number,
    visibilityTimeout: number
  ): Promise<number> {
    if (messageLimit > 10) throw new Error(`Cannot process more than 10 messages per function call. Received limit: ${messageLimit}`);

    let counter = 0;
    const messages = await receiveSQSMessages(
      this.queueUrl,
      { numOfMessages: messageLimit, visibilityTimeout }
    );
    if (messages.length > 0) {
      log.info(`processing ${messages.length} messages`);
      // If rate limiting is enabled, process sequentially to honor global rate limit
      if (this.rateLimitPerSecond) {
        for (const message of messages) {
          const waitTime = 1000/this.rateLimitPerSecond;
          log.info(`Waiting for ${waitTime} ms`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          const result = await this.processMessage(message, fn);
          counter += result;
        }
      } else {
        // No rate limiting - process all messages concurrently
        const processes = messages.map((message) => this.processMessage(message, fn));
        const results = await Promise.all(processes);
        counter = results.reduce((total: number, value) => total + value, 0);
      }
    }
    return counter;
  }

  async consume(fn: MessageConsumerFunction): Promise<number> {
    let messageLimit = this.messageLimit;
    log.info(`Attempting to process up to ${messageLimit} messages...`);

    let sum = 0;
    /* eslint-disable no-await-in-loop */
    // Only request up to the original messageLimit messages on subsequent `processMessages` calls
    while (messageLimit > 0) {
      let results = 0;
      if (messageLimit > 10) {
        results = await this.processMessages(fn, 10, this.visibilityTimeout);
        messageLimit -= 10;
      } else if (messageLimit > 0) {
        results = await this.processMessages(fn, messageLimit, this.visibilityTimeout);
        messageLimit -= messageLimit;
      }
      sum += results;
      if (this.timeRemainingFunc && this.timeRemainingFunc() < 5000) {
        log.info(`${Math.floor(this.timeRemainingFunc() / 1000)} seconds remaining in lambda, exiting...`);
        break;
      }
    }
    /* eslint-enable no-await-in-loop */

    log.info(`${sum} messages successfully processed from ${this.queueUrl}`);
    return sum;
  }
}
