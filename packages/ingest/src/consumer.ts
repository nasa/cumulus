import { receiveSQSMessages, SQSMessage } from '@cumulus/aws-client/SQS';
import * as sqs from '@cumulus/aws-client/SQS';
import { ExecutionAlreadyExists } from '@cumulus/aws-client/StepFunctions';
import Logger from '@cumulus/logger';

export type MessageConsumerFunction = (queueUrl: string, message: SQSMessage) => Promise<void>;

const log = new Logger({ sender: '@cumulus/ingest/consumer' });
export interface ConsumerConstructorParams {
  queueUrl: string,
  messageLimit?: number,
  timeLimit?: number,
  visibilityTimeout: number,
  deleteProcessedMessage?: boolean
}

export class Consumer {
  private readonly deleteProcessedMessage: boolean;
  private readonly messageLimit: number;
  private readonly now: number;
  private readonly queueUrl: string;
  private timeLapsed: boolean;
  private readonly timeLimit: number;
  private readonly visibilityTimeout: number;

  constructor({
    queueUrl,
    messageLimit = 1,
    timeLimit = 90,
    visibilityTimeout,
    deleteProcessedMessage = true,
  }: ConsumerConstructorParams) {
    this.queueUrl = queueUrl;
    this.messageLimit = messageLimit;
    this.visibilityTimeout = visibilityTimeout;
    this.timeLimit = timeLimit * 1000;
    this.now = Date.now();
    this.timeLapsed = false;
    this.deleteProcessedMessage = deleteProcessedMessage;
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
      const processes = messages.map((message) => this.processMessage(message, fn));
      const results = await Promise.all(processes);
      counter = results.reduce((total: number, value) => total + value, 0);
    }
    return counter;
  }

  async consume(fn: MessageConsumerFunction): Promise<number> {
    let messageLimit = this.messageLimit;
    log.info(`Attempting to process up to ${messageLimit} messages...`);

    let sum = 0;
    /* eslint-disable no-await-in-loop */
    // Only request up to the original messageLimit messages on subsequent `processMessages` calls
    while (messageLimit > 0 && !this.timeLapsed) {
      let results = 0;
      if (messageLimit > 10) {
        results = await this.processMessages(fn, 10, this.visibilityTimeout);
        messageLimit -= 10;
      } else if (messageLimit > 0) {
        results = await this.processMessages(fn, messageLimit, this.visibilityTimeout);
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
