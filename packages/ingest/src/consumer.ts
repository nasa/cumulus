import { receiveSQSMessages, deleteSQSMessage, SQSMessage } from '@cumulus/aws-client/SQS';
import { deleteS3Object } from '@cumulus/aws-client/S3';
import * as log from '@cumulus/common/log';

export type MessageConsumerFunction = (queueUrl: string, message: SQSMessage) => Promise<void>;

export interface ConsumerConstructorParams {
  queueUrl: string,
  messageLimit?: number,
  timeLimit?: number,
  visibilityTimeout: number,
  deleteProcessedMessage?: boolean,
  deleteProcessedMessageFromS3?: boolean
}

export class Consumer {
  private readonly deleteProcessedMessage: boolean;
  private readonly deleteProcessedMessageFromS3: boolean;
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
    deleteProcessedMessageFromS3 = true,
  }: ConsumerConstructorParams) {
    this.queueUrl = queueUrl;
    this.messageLimit = messageLimit;
    this.visibilityTimeout = visibilityTimeout;
    this.timeLimit = timeLimit * 1000;
    this.now = Date.now();
    this.timeLapsed = false;
    this.deleteProcessedMessage = deleteProcessedMessage;
    this.deleteProcessedMessageFromS3 = deleteProcessedMessageFromS3;
  }

  /**
   * Deletes archived SQS Message from S3
   *
   * @param {Object} message - SQS message
   * @returns {void}
   */
  private async deleteArchivedMessage(message: SQSMessage): Promise<any> {
    const bucket = process.env.system_bucket;
    log.debug(`Deleting archived message with ID ${message.MessageId} from bucket ${bucket}.`);
    const key = message.MessageId;
    if (bucket && key) {
      try {
        await deleteS3Object(bucket, key);
        log.debug(`Archived message ${message.MessageId} deleted from S3`);
      } catch (error) {
        log.error(`Could not delete message from bucket. ${error}`);
        throw error;
      }
    }
  }

  private async processMessage(
    message: SQSMessage,
    fn: MessageConsumerFunction
  ): Promise<0 | 1> {
    try {
      await fn(this.queueUrl, message);
      if (this.deleteProcessedMessage) {
        await deleteSQSMessage(this.queueUrl, message.ReceiptHandle);
      }
      if (this.deleteProcessedMessageFromS3) {
        await this.deleteArchivedMessage(message);
      }
      return 1;
    } catch (error) {
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
