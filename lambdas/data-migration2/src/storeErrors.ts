import { WriteStream } from 'node:fs';

const fs = require('fs');
const moment = require('moment');
const stream = require('stream');
const { promisify } = require('util');
const { s3 } = require('@cumulus/aws-client/services');

/**
 *  Create error file write stream helper
 * @param {string} migrationName - Name of migration
 * @param {string | undefined} timestamp - Timestamp for unit testing
 * @returns {Object} - Object containing error write stream and file path string
 */
export const createErrorFileWriteStream = (migrationName: string, timestamp?: string) => {
  const dateString = timestamp || moment.utc().format('YYYY-MM-DD_HH:MM:SS.SSSS');
  const filepath = `${migrationName}ErrorLog-${dateString}.json`;
  const errorFileWriteStream = fs.createWriteStream(filepath);
  errorFileWriteStream.write('{ "errors": [\n');

  return { errorFileWriteStream, filepath };
};

/**
 *  Close error file write stream helper
 * @param {WriteStream} errorFileWriteStream - Error file write stream to close
 * @returns {Promise<void>}
 */
export const closeErrorFileWriteStream = async (errorFileWriteStream: WriteStream) => {
  errorFileWriteStream.end('\n]}');
  const finished = promisify(stream.finished);
  await finished(errorFileWriteStream);
};

/**
 * Store migration errors JSON file on S3.
 *
 * @param {Object} params
 * @param {string} params.bucket - Name of S3 bucket where file will be uploaded
 * @param {string} params.filepath - Write Stream file path
 * @param {string} params.migrationName - Name of migration
 * @param {string} params.stackName - User stack name/prefix
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
  const dateString = timestamp || moment.utc().format('YYYY-MM-DD_HH:MM:SS');
  const key = `${stackName}/${fileKey}-${dateString}.json`;
  await s3().putObject({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filepath),
  }).promise();
  fs.unlinkSync(filepath);
};
