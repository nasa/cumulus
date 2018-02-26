'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports.s3Mixin = (superclass) => class extends superclass {
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
      Bucket: this.host
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
      FetchOwner: true
    };

    // The constructor defaults the path to '/' if one is not specified when
    // this object is created.  That is a problem in the case of S3 because
    // S3 keys do not start with a leading slash.  This module is mixed in to
    // a number of different types of objects, not all of which have the same
    // constructor arguments.  We can't override the constructor here because
    // of that.  As a result, we need to test for a default path of '/'.
    // also handle the edge case where leading / in key creates incorrect path
    // by remove the first slash if it exists
    if (this.path && this.path !== '/') {
      if (this.path[0] === '/') {
        this.path = this.path.substr(1);
      }
      params.Prefix = this.path;
    }

    const objects = await aws.listS3ObjectsV2(params);

    return objects.map((object) => {
      const file = {
        name: path.basename(object.Key),
        size: object.Size,
        time: object.LastModified,
        owner: object.Owner.DisplayName,
        path: path.dirname(object.Key)
      };

      // If the object is at the top level of the bucket, path.dirname is going
      // to return "." as the dirname.  It should instead be null.
      if (file.path === '.') file.path = null;

      return file;
    });
  }
};
