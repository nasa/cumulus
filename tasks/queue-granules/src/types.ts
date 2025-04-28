/**
 * This file is generated using @cumulus/schema. Any modifications made to this file
 * will be overwritten when the build script is rerun. Please do not modify this file.
 */

/**
 * Describes the config used by the queue-granules task
 */
export interface QueueGranulesConfig {
  granuleIngestWorkflow: string;
  internalBucket: string;
  provider: {
    id: string;
  };
  preferredQueueBatchSize?: number | null;
  queueUrl: string;
  stackName: string;
  concurrency?: number;
  executionNamePrefix?: string;
  childWorkflowMeta?: {};
}

/**
 * Describes the input and config used by the queue-granules task
 */
export interface QueueGranulesInput {
  pdr?: {
    name: string;
    path: string;
  };
  granules: {
    type?: string;
    granuleId: string;
    dataType?: string;
    version?: string;
    producerGranuleId: string,
    provider?: string;
    collectionId?: string;
    status?: string;
    createdAt?: number;
    updatedAt?: number;
    files: {
      [k: string]: unknown;
    }[];
  }[];
}

/**
 * Describes the output produced by the queue-granules task
 */
export interface QueueGranulesOutput {
  /**
   * a list of step function execution arns of granules queued
   */
  running: string[];
  /**
   * Product Delivery Record
   */
  pdr?: {
    name: string;
    path: string;
  };
}
