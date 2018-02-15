'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs');
const os = require('os');
const path = require('path');
const urljoin = require('url-join');

module.exports.s3Mixin = (superclass) => class extends superclass {

  /**
   * Downloads a given url and upload to a given S3 location
   *
   * @param {string} filepath - the locatio of the file to be uploaded
   * @param {string} bucket - the S3 bucket to upload to
   * @param {string} key - the base path of the S3 key
   * @param {string} filename - the filename to be uploaded
   * @returns {Promise} a promise
   * @private
   */
  async sync(filepath, bucket, key, filename) {
    const fullKey = path.join(key, filename);
    const params = {
      Bucket: bucket,
      CopySource: filepath.replace(/^s3:\//, ''),
      Key: fullKey,
      ACL: 'private'
    };
    await aws.s3().copyObject(params).promise();
    return urljoin('s3://', bucket, key, filename);
  }

  /**
   * Upload a file to S3
   *
   * @param {string} bucket - the S3 bucket to upload to
   * @param {string} key - the base path of the S3 key
   * @param {string} filename - the filename to be uploaded to
   * @param {string} tempFile - the location of the file to be uploaded
   * @returns {Promise<string>} - the S3 URL that the file was uploaded to
   */
  async upload(bucket, key, filename, tempFile) {
    const fullKey = `${key}/${filename}`;

    await aws.s3().putObject({
      Bucket: bucket,
      Key: fullKey,
      Body: fs.createReadStream(tempFile)
    }).promise();

    return `s3://${bucket}/${fullKey}`;
  }

  /**
   * Downloads the file to disk, difference with sync is that
   * this method involves no uploading to S3
   *
   * @param {string} filepath - the path of the file to be downloaded
   * @param {string} filename - the name of the file to be downloaded
   * @returns {Promise} a promise
   */
  async download(filepath, filename) {
    // let's stream to file
    const tempFile = path.join(os.tmpdir(), filename);
    const params = aws.parseS3Uri(`${filepath.replace(/\/+$/, '')}/${filename}`);
    return aws.downloadS3File(params, tempFile);
  }

  /**
   * List all files from a given endpoint
   *
   * @returns {Promise} a promise
   * @private
   */
  async list() {
    const { Bucket, Prefix } = aws.parseS3Uri(this.path);

    const objects = await aws.listS3ObjectsV2({ Bucket, Prefix, FetchOwner: true });

    return objects.map((object) => ({
      name: path.basename(object.Key),
      size: object.Size,
      time: object.LastModified,
      owner: object.Owner.DisplayName,
      path: `s3://${Bucket}/${path.dirname(object.Key)}/`
    }));
  }
};
