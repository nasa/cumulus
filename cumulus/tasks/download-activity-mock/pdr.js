'use strict';

const aws = require('cumulus-common/aws');
const path = require('path');
const fs = require('fs');

/**
   * Get the contents of a PDR from a SIPS server (S3 bucket for now)
   * @param {string} s3Bucket The bucket from which to read the file
   * @param {string} s3Key The key for the file object
   * @return An object with keys `fileName` and `pdr`.
   */
exports.getPdr = async (s3Bucket, s3Key) => {
  await aws.downloadS3Files([{ Bucket: s3Bucket, Key: s3Key }], '/tmp');
  const fileName = path.basename(s3Key);
  const filePath = path.join('/tmp', fileName);
  const pdr = fs.readFileSync(filePath, 'utf8');
  return { fileName: fileName, pdr: pdr.toString() };
};
