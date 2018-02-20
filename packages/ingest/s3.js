'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports.s3Mixin = (superclass) => class extends superclass {
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
   * Fetch object from S3 to disk
   *
   * @param {string} s3Path - the S3 key path of the file to be downloaded
   * @param {string} filename - the name of the file to be downloaded
   * @returns {Promise} - the filename where the object was downloaded to
   */
  download(s3Path, filename) {
    const tempFile = path.join(os.tmpdir(), filename);

    // Handle the case where the s3Path is null, meaning that the S3 object
    // we're fetching is at the top level of the bucket.
    const Key = s3Path ? `${s3Path}/${filename}` : filename;

    const s3Obj = {
      Key,
      Bucket: this.provider.host
    };

    return aws.downloadS3File(s3Obj, tempFile);
  }

  /**
   * List all files from a given endpoint
   *
   * @returns {Promise} file list of the endpoint
   * @private
   */
  async list() {
    const params = {
      Bucket: this.host,
      FetchOwner: true
    };

    // The constructor defaults the path to '/' if one is not specified when
    // this object is created.  That is a problem in the case of S3 because
    // S3 keys do not start with a leading slash.  This module is mixed in to
    // a number of different types of objects, not all of which have the same
    // constructor arguments.  We can't override the constructor here because
    // of that.  As a result, we need to test for a default path of '/'.
    if (this.path && this.path !== '/') params.Prefix = this.path;

    const objects = await aws.listS3ObjectsV2(params);

    return objects.map((object) => {
      const file = {
        name: path.basename(object.Key),
        size: object.Size,
        time: object.LastModified,
        owner: object.Owner.DisplayName,
        path: path.dirname(object.Key),
        key: object.Key
      };

      // If the object is at the top level of the bucket, path.dirname is going
      // to return "." as the dirname.  It should instead be null.
      if (file.path === '.') file.path = null;

      return file;
    });
  }
};
