import { receiveSQSMessages, SQSMessage } from '@cumulus/aws-client/SQS';
import * as sqs from '@cumulus/aws-client/SQS';
import { ExecutionAlreadyExists } from '@cumulus/aws-client/StepFunctions';
import Logger from '@cumulus/logger';
import { sleep } from '@cumulus/common';

export type MessageConsumerFunction = (queueUrl: string, message: SQSMessage) => Promise<void>;

const log = new Logger({ sender: '@cumulus/ingest/consumer' });
/**
 * Configuration parameters for the rate-limited consumer.
 */
export interface ConsumerConstructorParams {
  /**
   * URLs of the SQS queues to poll.
   */
  queueUrls: string[];
  /**
   * Function that returns the remaining time in milliseconds before Lambda timeout.
   */
  timeRemainingFunc: () => number;
  /**
   * The visibility timeout in milliseconds used when fetching messages from the SQS queues.
   */
  visibilityTimeout: number;
  /**
   * Whether to delete messages after successful processing. Defaults to true.
   */
  deleteProcessedMessage?: boolean;
  /**
   * Maximum number of messages to process per second.
   */
  rateLimitPerSecond: number;
}

export class ConsumerRateLimited {
  private readonly deleteProcessedMessage: boolean;
  private readonly queueUrls: string[];
  private readonly timeRemainingFunc: (bufferSeconds: number) => number;
  private readonly visibilityTimeout: number;
  private readonly rateLimitPerSecond: number;
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
    // The maximum number of messages to fetch in one request per queue
    this.messageLimitPerFetch = 10;
    // The amount of time to wait before retrying to fetch messages when none are found
    this.waitTime = 5000;
  }

  private async processMessage(
    message: SQSMessage,
    fn: MessageConsumerFunction,
    queueUrl: string
  ): Promise<boolean> {
    try {
      await fn(queueUrl, message);
    } catch (error) {
      if (error instanceof ExecutionAlreadyExists) {
        log.debug('Deleting message for execution that already exists...');
        await sqs.deleteSQSMessage(queueUrl, message.ReceiptHandle);
        log.debug('Completed deleting message.');
        return true;
      }
      log.error(error);
      return false;
    }
    if (this.deleteProcessedMessage) {
      await sqs.deleteSQSMessage(queueUrl, message.ReceiptHandle);
    }
    return true;
  }

  private async processMessages(
    fn: MessageConsumerFunction,
    messagesWithQueueUrls: Array<[SQSMessage, string]>
  ): Promise<number> {
    let counter = 0;
    for (const [message, queueUrl] of messagesWithQueueUrls) {
      const waitTime = 1000 / this.rateLimitPerSecond;
      log.debug(`Waiting for ${waitTime} ms`);
      // We normally don't want to await in a loop due to decreased performance
      // from running sequentially, but here we want to enforce rate limiting
      // by specifically adding a delay to each loop iteration.
      // eslint-disable-next-line no-await-in-loop
      await sleep(waitTime);
      // eslint-disable-next-line no-await-in-loop
      if (await this.processMessage(message, fn, queueUrl)) {
        counter += 1;
      }
    }
    return counter;
  }

  private async fetchMessages(
    queueUrl: string,
    messageLimit: number
  ): Promise<Array<[SQSMessage, string]>> {
    const messages = await receiveSQSMessages(queueUrl, {
      numOfMessages: messageLimit,
      visibilityTimeout: this.visibilityTimeout,
    });
    return messages.map((message) => [message, queueUrl]);
  }

  private async fetchMessagesFromAllQueues(): Promise<Array<[SQSMessage, string]>> {
    return Promise.all(
      this.queueUrls.map((queueUrl) =>
        this.fetchMessages(queueUrl, this.messageLimitPerFetch))
    ).then((messageArrays) => messageArrays.flat());
  }

  async consume(fn: MessageConsumerFunction): Promise<number> {
    let messageCounter = 0;
    let processingPromise: Promise<number> | undefined;
    let fetchPromise: Promise<Array<[SQSMessage, string]>> | undefined;
    let messages: Array<[SQSMessage, string]> | undefined;
    let processTimeMilliseconds: number = 0;
    let startTime: number;

    // The below block of code attempts to always have a batch of messages
    // available for `processMessages` to process, so, after the initial fetch,
    // we'll immediately start fetching the next batch while processing the
    // current one

    // There are several await-in-loop instances below all required for flow control to assure
    // we're submitting at a specified rate.
    while (this.timeRemainingFunc(processTimeMilliseconds) > 0) {
      if (messages === undefined) {
        // This will be run in the first iteration, included in the loop in case of a small
        // timeRemainingFunc value
        // eslint-disable-next-line no-await-in-loop
        messages = await this.fetchMessagesFromAllQueues();
      }
      if (messages.length === 0) {
        log.info(
          `No messages fetched, waiting ${this.waitTime} ms before retrying`
        );
        // eslint-disable-next-line no-await-in-loop
        await sleep(this.waitTime);
        // eslint-disable-next-line no-await-in-loop
        messages = await this.fetchMessagesFromAllQueues();
      } else {
        // Start processing current batch and immediately fetch next batch
        processingPromise = this.processMessages(fn, messages);
        fetchPromise = this.fetchMessagesFromAllQueues();

        startTime = Date.now();
        // Wait for processing to complete and increment counter
        // eslint-disable-next-line no-await-in-loop
        messageCounter += await processingPromise;
        if (processTimeMilliseconds === 0) {
          // First processing time measurement, add 50% buffer to account for possible longer
          // processing time on the last iteration
          processTimeMilliseconds = (Date.now() - startTime) + (Date.now() - startTime) * 0.5;
        }

        // Get the next batch that was fetched concurrently
        // eslint-disable-next-line no-await-in-loop
        messages = await fetchPromise;
      }
    }

    // Process any remaining messages after time has expired
    if (messages !== undefined && messages.length > 0) {
      messageCounter += await this.processMessages(fn, messages);
    }

    log.info(
      `${messageCounter} messages successfully processed from ${this.queueUrls}`
    );
    return messageCounter;
  }
}
