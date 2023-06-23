/**
 * This file is generated using @cumulus/schema. Any modifications made to this file
 * will the overwritten when the build script is rerun. Please do not modify this file.
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
    provider?: string;
    collectionId?: string;
    status?: string;
    createdAt?: number;
    updatedAt?: number;
    files: {
      /**
       * Bucket where file is archived in S3
       */
      bucket: string;
      /**
       * Checksum value for file
       */
      checksum?: string;
      /**
       * Type of checksum (e.g. md5, sha256, etc)
       */
      checksumType?: string;
      /**
       * Name of file (e.g. file.txt)
       */
      fileName?: string;
      /**
       * S3 Key for archived file
       */
      key: string;
      /**
       * Size of file (in bytes)
       */
      size?: number;
      /**
       * Source URI of the file from origin system (e.g. S3, FTP, HTTP)
       */
      source?: string;
      /**
       * Type of file (e.g. data, metadata, browse)
       */
      type?: string;
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
