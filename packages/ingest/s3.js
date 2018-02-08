'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs');
const os = require('os');
const path = require('path');
const urljoin = require('url-join');

module.exports.s3Mixin = superclass => class extends superclass {

  /**
   * Downloads a given url and upload to a given S3 location
   * @return {Promise}
   * @private
   */
  async sync(_path, bucket, key, filename) {
    const source = _path.replace(/^s3:\//, '');
    const params = {
      Bucket: bucket,
      CopySource: _path.replace(/^s3:\//, ''),
      Key: path.join(key, filename),
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
   * @return {Promise}
   * @private
   */
  async download(_path, filename) {
    // let's stream to file
    const tempFile = path.join(os.tmpdir(), filename);
    const params = aws.parseS3Uri(`${_path.replace(/\/+$/, '')}/${filename}`);
    return new Promise((resolve, reject) => {
      aws.s3().getObject(params, (err, data) => {
        if (err) return reject(err);
        fs.writeFile(tempFile, data.Body, (err) => {
          if (err) return reject(err);
        });
      });
      return resolve(tempFile);
    });
  }

  async _list(params, files) {
    return new Promise((resolve, reject) => {
      aws.s3().listObjectsV2(params, (err, data) => {
        if (err) return reject(err);
        let result = data.Contents.map(d => ({
          name: path.basename(d.Key),
          size: d.Size,
          time: d.LastModified,
          owner: d.Owner.DisplayName,
          path: `s3://${data.Name}/${path.dirname(d.Key)}/`
        }));
        files = files.concat(result);
        if (data.IsTruncated) {
          params.ContinuationToken = data.NextContinuationToken;
          return this._list(params, files).then((r) => {
            return resolve(r);
          }).catch(e => reject(e));
        }
        else return resolve(files);
      });
    });
  }

  /**
   * List all PDR files from a given endpoint
   * @return {Promise}
   * @private
   */
  async list() {
    let files = [];
    const s3params = aws.parseS3Uri(this.path);
    //TODO remove MaxKeys
    let params = {
      Bucket: s3params.Bucket,
      MaxKeys: 3,
      Prefix: s3params.Key || '/',
      FetchOwner: true
    };
    return this._list(params, files);
  }
};
