import { s3PutObject } from '@cumulus/aws-client/S3';

/**
 * Store migration errors in JSON file in S3
 * @param {string} bucket
 * @param {string[]} message
 * @param {string} recordClassification
 * @param {string | undefined} stackName
 */
export const storeErrors = async (
  bucket: string,
  message: string[],
  recordClassification: string,
  stackName?: string) => {
  const file = `{
    "errors": ${JSON.stringify(message)}
  }`;
  const filename = `data-migration2-${recordClassification}-errors.json`;
  const key = `${stackName}/${filename}` || filename;
  await s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: file,
  });
};
