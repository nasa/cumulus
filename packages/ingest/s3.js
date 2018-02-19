'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports.s3Mixin = (superclass) => class extends superclass {

  /**
   * Build a discovery or ingest object with S3-specific properties
   *
   * @param {Object} event - a Cumulus event
   */
  constructor(event) {
    super(event);

    this.sourceBucket = this.provider.host;

    // Defaults to null, not "/" like in other mixins
    this.path = this.collection.provider_path || null;
    this.keyPrefix = this.path;
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
   * Fetch object from S3 to disk
   *
   * @param {string} s3Path - the S3 key path of the file to be downloaded
   * @param {string} filename - the name of the file to be downloaded
   * @returns {Promise} - the filename where the object was downloaded to
   */
  download(s3Path, filename) {
    const tempFile = path.join(os.tmpdir(), filename);

    const Key = s3Path ? `${s3Path}/${filename}` : filename;

    const s3Obj = {
      Key,
      Bucket: this.sourceBucket
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
      Bucket: this.sourceBucket,
      FetchOwner: true
    };
    if (this.keyPrefix) params.Prefix = this.keyPrefix;

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

      if (file.path === '.') file.path = null;

      return file;
    });
  }
};
