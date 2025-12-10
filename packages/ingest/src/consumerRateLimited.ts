import { receiveSQSMessages, SQSMessage } from '@cumulus/aws-client/SQS';
import * as sqs from '@cumulus/aws-client/SQS';
import { ExecutionAlreadyExists } from '@cumulus/aws-client/StepFunctions';
import Logger from '@cumulus/logger';

export type MessageConsumerFunction = (queueUrl: string, message: SQSMessage) => Promise<void>;

const log = new Logger({ sender: '@cumulus/ingest/consumer' });
export interface ConsumerConstructorParams {
  queueUrls: string[],
  timeRemainingFunc: () => number,
  visibilityTimeout: number,
  deleteProcessedMessage?: boolean,
  rateLimitPerSecond: number;
}

export class ConsumerRateLimited {
  private readonly deleteProcessedMessage: boolean;
  private readonly queueUrls: string[];
  private readonly timeRemainingFunc: () => number;
  private readonly visibilityTimeout: number;
  private readonly rateLimitPerSecond: number;
  private readonly timeBuffer: number;
  private readonly messageLimitPerFetch: number;
  private readonly waitTime: number;

  constructor({
    queueUrls,
    timeRemainingFunc,
    visibilityTimeout,
    rateLimitPerSecond,
    deleteProcessedMessage = true,
  }: ConsumerConstructorParams) {
    this.queueUrls = queueUrls;
    this.visibilityTimeout = visibilityTimeout;
    this.timeRemainingFunc = timeRemainingFunc;
    this.deleteProcessedMessage = deleteProcessedMessage;
    this.rateLimitPerSecond = rateLimitPerSecond;
    // The amount of time to stop processing messages before Lambda times out
    this.timeBuffer = 1000;
    // The maximum number of messages to fetch in one request per queue
    this.messageLimitPerFetch = 10;
    // The amount of time to wait before retrying to fetch messages when none are found
    this.waitTime = 5000;
  }

  private async processMessage(
    message: SQSMessage,
    fn: MessageConsumerFunction,
    queueUrl: string
  ): Promise<0 | 1> {
    try {
      await fn(queueUrl, message);
      if (this.deleteProcessedMessage) {
        await sqs.deleteSQSMessage(queueUrl, message.ReceiptHandle);
      }
      return 1;
    } catch (error) {
      if (error instanceof ExecutionAlreadyExists) {
        log.debug('Deleting message for execution that already exists...');
        await sqs.deleteSQSMessage(queueUrl, message.ReceiptHandle);
        log.debug('Completed deleting message.');
        return 1;
      }
      log.error(error);
      return 0;
    }
  }

  private async processMessages(
    fn: MessageConsumerFunction,
    messagesWithQueueUrls: Array<[SQSMessage, string]>
  ): Promise<number> {
    let counter = 0;
    for (const [message, queueUrl] of messagesWithQueueUrls) {
      const waitTime = 1000/this.rateLimitPerSecond;
      log.debug(`Waiting for ${waitTime} ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      const result = await this.processMessage(message, fn, queueUrl);
      counter += result;
    }
    return counter;
  }

  private async fetchMessages(queueUrl: string, messageLimit: number): Promise<Array<[SQSMessage, string]>> {
    const messages = await receiveSQSMessages(
      queueUrl,
      { numOfMessages: messageLimit, visibilityTimeout: this.visibilityTimeout }
    );
    return messages.map((message) => [message, queueUrl]);
  }

  async consume(fn: MessageConsumerFunction): Promise<number> {
    let messageCounter = 0;
    let processingPromise: Promise<number> | null = null;

    // The below block of code attempts to always have a batch of messages available for `processMessages` to process,
    // so, after the initial fetch, we'll immediately start fetching the next batch while processing the current one

    let messages = await Promise.all(
      this.queueUrls.map(queueUrl => this.fetchMessages(queueUrl, this.messageLimitPerFetch))
    ).then((messageArrays) => messageArrays.flat());

    while (this.timeRemainingFunc() > this.timeBuffer) {
      if (messages.length === 0) {
        log.info(`No messages fetched, waiting ${this.waitTime} ms before retrying`);
        await new Promise((resolve) => setTimeout(resolve, this.waitTime));
        messages = await Promise.all(
          this.queueUrls.map(queueUrl => this.fetchMessages(queueUrl, this.messageLimitPerFetch))
        ).then((messageArrays) => messageArrays.flat());
      } else {
        // Start processing current batch and immediately fetch next batch
        processingPromise = this.processMessages(fn, messages);
        const fetchPromise = Promise.all(
          this.queueUrls.map(queueUrl => this.fetchMessages(queueUrl, this.messageLimitPerFetch))
        ).then((messageArrays) => messageArrays.flat());

        // Wait for processing to complete and increment counter
        messageCounter += await processingPromise;
        processingPromise = null;

        // Get the next batch that was fetched concurrently
        messages = await fetchPromise;
      }
    }

    log.info(`${messageCounter} messages successfully processed from ${this.queueUrls}`);
    return messageCounter;
  }
}
