'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs');
const os = require('os');
const path = require('path');
const urljoin = require('url-join');

module.exports.s3Mixin = (superclass) => class extends superclass {

  /**
   * Copies an object from one S3 location to another
   *
   * @param {string} filepath - the S3 URI of the file to be uploaded
   * @param {string} bucket - the S3 bucket to upload to
   * @param {string} key - the S3 key of the destination location
   * @param {string} filename - the detination file name
   * @returns {Promise} the S3 URI of the destination file
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
   * @param {string} key - the S3 key of the destination location
   * @param {string} filename - the filename to be uploaded to
   * @param {string} tempFile - the location of the file to be uploaded
   * @returns {Promise<string>} - the S3 URI of the destination file
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
   * @param {string} filepath - the S3 URI of the file to be downloaded
   * @param {string} filename - the name of the file to be downloaded
   * @returns {Promise} - the path of the destination file
   */
  download(filepath, filename) {
    // let's stream to file
    const tempFile = path.join(os.tmpdir(), filename);
    const params = aws.parseS3Uri(`${filepath.replace(/\/+$/, '')}/${filename}`);
    return aws.downloadS3File(params, tempFile);
  }

  /**
   * List all files from a given endpoint
   *
   * @returns {Promise} file list of the endpoint
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
