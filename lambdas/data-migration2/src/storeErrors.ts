import moment from 'moment';

const { s3 } = require('@cumulus/aws-client/services');
const fs = require('fs');

/**
 * Store migration errors JSON file on S3.
 *
 * @param {Object} params
 * @param {string} params.bucket - Name of S3 bucket where file will be uploaded
 * @param {string[]} params.filepath - Write Stream file path
 * @param {string} params.recordClassification - Classification of record
 * @param {string} params.stackName - User stack name/prefix
 * @param {string | undefined} params.timestamp - Timestamp for unit testing
 * @returns {void}
 */
export const storeErrors = async (params: {
  bucket: string,
  filepath: string,
  recordClassification: string,
  stackName: string,
  timestamp?: string,
}) => {
  const { bucket, filepath, recordClassification, stackName, timestamp } = params;
  const fileKey = `data-migration2-${recordClassification}-errors`;
  const dateString = timestamp || moment.utc().format('YYYY-MM-DD_HH:MM:SS');
  const key = `${stackName}/${fileKey}_${dateString}.json`;
  await s3().putObject({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filepath),
  }).promise();
  fs.unlinkSync(filepath);
};
