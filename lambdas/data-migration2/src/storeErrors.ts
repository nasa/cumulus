import Logger from '@cumulus/logger';
import { WriteStream, createReadStream, createWriteStream, unlinkSync } from 'fs';

const JSONStream = require('JSONStream');
const { finished } = require('stream');
const { promisify } = require('util');
const { s3 } = require('@cumulus/aws-client/services');

const logger = new Logger({ sender: '@cumulus/data-migration/storeErrors' });

/**
 * Helper to create error file write stream
 * @param {string} migrationName         - Name of migration
 * @param {string | undefined} timestamp - Timestamp for unit testing
 * @returns {Object}                     - Object containing write streams and file path
 */
export const createErrorFileWriteStream = (migrationName: string, timestamp?: string) => {
  const dateString = timestamp || new Date().toISOString();
  const filepath = `${migrationName}ErrorLog-${dateString}.json`;
  const errorFileWriteStream = createWriteStream(filepath);
  const jsonWriteStream = JSONStream.stringify('{"errors": [\n', '\n,', '\n]}\n');
  jsonWriteStream.pipe(errorFileWriteStream);

  return { jsonWriteStream, errorFileWriteStream, filepath };
};

/**
 * Helper to close error Error file and JSON write streams
 * @param {Object} params
 * @param {WriteStream} params.errorFileWriteStream - Error file write stream to close
 * @param {WriteStream} params.jsonWriteStream      - JSON file write stream to close
 * @returns {Promise<void>}
 */
export const closeErrorWriteStreams = async (params:{
  errorFileWriteStream: WriteStream
  jsonWriteStream: WriteStream,
}) => {
  const { jsonWriteStream, errorFileWriteStream } = params;
  jsonWriteStream.end();
  errorFileWriteStream.end();
  const asyncFinished = promisify(finished);
  await asyncFinished(errorFileWriteStream);
};

/**
 * Store migration errors JSON file on S3.
 *
 * @param {Object} params
 * @param {string} params.bucket                - Name of S3 bucket where file will be uploaded
 * @param {string} params.filepath              - Write Stream file path
 * @param {string} params.migrationName         - Name of migration
 * @param {string} params.stackName             - User stack name/prefix
 * @param {string | undefined} params.timestamp - Timestamp for unit testing
 * @returns {Promise<void>}
 */
export const storeErrors = async (params: {
  bucket: string,
  filepath: string,
  migrationName: string,
  stackName: string,
  timestamp?: string,
}) => {
  const { bucket, filepath, migrationName, stackName, timestamp } = params;
  const fileKey = `data-migration2-${migrationName}-errors`;
  const dateString = timestamp || new Date().toISOString();
  const key = `${stackName}/${fileKey}-${dateString}.json`;

  await s3().putObject({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(filepath),
  });

  logger.info(`Stored error log file on S3 at s3://${bucket}/${key}`);
  unlinkSync(filepath);
};
