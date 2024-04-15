// Utility functions to help with S3 multi-part uploads

import range from 'lodash/range';

import {
  AbortMultipartUploadRequest,
  CompleteMultipartUploadRequest,
  CompleteMultipartUploadOutput,
  CreateMultipartUploadRequest,
  UploadPartCopyRequest,
} from '@aws-sdk/client-s3';

import { s3 } from '../services';

export interface S3CompleteMultipartUploadOutput extends CompleteMultipartUploadOutput {
  ETag: string
}

type Chunk = {
  start: number,
  end: number
};

const MB = 1024 * 1024;

/**
 * Each part of a multi-part copy needs to specify a byte range to be copied.
 * This byte range has a starting byte and an ending byte (inclusive) that makes
 * up the part. The maximum allowed chunk size is 5368709120 bytes.
 *
 * This function takes a file size and an optional maxSize. It returns an array
 * of objects, each containing a `start` and an `end` value. These will make up
 * the ranges of the multi-part copy.
 *
 * From anecdotal testing, a chunk size of 250 MB seems to perform fairly well.
 *
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_UploadPartCopy.html
 *
 * @param {number} objectSize - size of the object
 * @param {number} chunkSize - chunk size of the S3 multipart uploads
 * @returns {Promise<Array<Chunk>>} - array of chunks
 */
export const createMultipartChunks = (
  objectSize: number,
  chunkSize = 250 * MB
): Chunk[] =>
  range(0, objectSize, chunkSize)
    .map(
      (start) => ({
        start,
        end: Math.min(start + chunkSize, objectSize) - 1,
      })
    );

export const createMultipartUpload = async (
  params: CreateMultipartUploadRequest
) => await s3().createMultipartUpload(params);

export const completeMultipartUpload = async (
  params: CompleteMultipartUploadRequest
): Promise<S3CompleteMultipartUploadOutput> => {
  const result = await s3().completeMultipartUpload(params);
  return <S3CompleteMultipartUploadOutput>result;
};

export const abortMultipartUpload = async (
  params: AbortMultipartUploadRequest
) => await s3().abortMultipartUpload(params);

export const uploadPartCopy = async (
  params: UploadPartCopyRequest
) => await s3().uploadPartCopy(params);
