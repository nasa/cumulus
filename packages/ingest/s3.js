'use strict';

const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const path = require('path');
const errors = require('@cumulus/common/errors');

module.exports.s3Mixin = (superclass) => class extends superclass {
  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise.<string>} - the path that the file was saved to
   */
  async download(remotePath, localPath) {
    const remoteUrl = `s3://${this.host}/${remotePath}`;
    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    const s3Obj = {
      Bucket: this.host,
      Key: remotePath
    };

    const retval = await aws.downloadS3File(s3Obj, localPath);
    log.info(`Finishing downloading ${remoteUrl}`);

    return retval;
  }

  /**
   * List all files from a given endpoint
   *
   * @returns {Promise} file list of the endpoint
   * @private
   */
  async list() {
    // There are two different "path" variables being set here, which gets
    // confusing.  "this.path" originally comes from
    // "event.config.collection.provider_path".  In the case of S3, it refers
    // to the prefix used when searching for objects.  That should be the
    // _only_ time that variable is used.
    //
    // The other use of "path" here is in reference to the file that was
    // discovered.  It's easiest to explain using an example.  Given this URL:
    //
    // s3://my-bucket/some/path/my-file.pdr
    //
    // file.path = "some/path"
    // file.name = "my-file.pdr"
    //
    // Here's an example where the object is at the top level of the bucket:
    //
    // s3://my-bucket/my-file.pdr
    //
    // file.path = null
    // file.name = "my-file.pdr"
    //
    // file.path should not be used anywhere outside of this file.

    const params = {
      Bucket: this.host,
      FetchOwner: true,
      Prefix: this.path
    };

    const objects = await aws.listS3ObjectsV2(params);

    return objects.map((object) => {
      const file = {
        name: path.basename(object.Key),
        path: path.dirname(object.Key),
        size: object.Size,
        time: (new Date(object.LastModified)).valueOf()
      };

      // If the object is at the top level of the bucket, path.dirname is going
      // to return "." as the dirname.  It should instead be null.
      if (file.path === '.') file.path = null;

      return file;
    });
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise} s3 uri of destination file
   */
  async sync(remotePath, bucket, key) {
    const remoteUrl = aws.buildS3Uri(this.host, remotePath);
    const s3uri = aws.buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    const exist = await aws.fileExists(this.host, remotePath.replace(/^\/+/, ''));
    if (!exist) {
      const message = `Source file not found ${remoteUrl}`;
      throw new errors.FileNotFound(message);
    }
    const params = {
      Bucket: bucket,
      CopySource: remoteUrl.replace(/^s3:\//, ''),
      Key: key,
      ACL: 'private'
    };
    log.info('sync params:', params);
    const startTime = new Date();

    await aws.s3CopyObject(params);

    const syncTimeSecs = (new Date() - startTime) / 1000.0;
    log.info(`s3 Upload completed in ${syncTimeSecs} secs`, s3uri);
    const objectData = await aws.headObject(params.Bucket, params.Key);
    log.info(`synced ${objectData.ContentLength} bytes`);
    return s3uri;
  }
};
