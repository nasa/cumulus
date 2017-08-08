'use strict';

const fs = require('fs');
const get = require('lodash.get');
const urljoin = require('url-join');
const uploadS3Files = require('@cumulus/common/aws').uploadS3Files;
const ftpMixin = require('./ftp').ftpMixin;
const httpMixin = require('./http').httpMixin;


/**
 * This is a base class for ingesting and parsing a single PDR
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */

class Granule {
  constructor(granule, provider, collection, buckets) {
    if (this.constructor === Granule) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.buckets = buckets;
    this.granule = granule;
    this.collection = collection;
    this.port = get(provider, 'port', 21);
    this.host = get(provider, 'host', null);
    this.path = get(provider, 'path', '/');
    this.provider = provider;
    this.endpoint = urljoin(this.host, this.path);
    this.username = get(provider, 'username', null);
    this.password = get(provider, 'password', null);
    this.fileType = {}; // stores the filenames and their collection-related names
  }

  async ingest() {
    // determine the file key for each filename
    this.granule.files.forEach((f) => {
      if (!this.fileType[f.filename]) {
        Object.keys(this.collection.files).forEach((keyName) => {
          // check if regex match
          const def = this.collection.files[keyName];
          const test = new RegExp(def.regex);

          const match = f.filename.match(test);
          if (match) {
            this.fileType[f.filename] = keyName;
          }
        });
      }
    });

    // for each granule file
    // download / verify checksum / upload
    const granules = this.granule.files.map(f => this.ingestFile(f));
    const allDownloads = await Promise.all(granules);
    const files = {};

    allDownloads.forEach((d) => (files[d.key] = d.uri));
    return {
      collectionName: this.collection.name,
      granuleId: this.granule.granuleId,
      files
    };
  }

  /**
   * Ingest individual files
   * @private
   */
  async ingestFile(file) {
    // we considered a direct stream from source to S3 but since
    // it doesn't work with FTP connections, we decided to always download
    // and then upload
    const tempFile = await this._download(this.host, file.path, file.filename);

    // run the checksum if there is a checksum value available
    // TODO: add support for md5
    if (file.checksumType && file.checksumType.toLowerCase() === 'cksum') {
      //await this._cksum(tempFile, parseInt(file.checksumValue));
    }

    // bucket name for each file is differnet
    const key = this.fileType[file.filename];
    const access = this.collection.files[key].access || this.collection.files[key].bucket;
    const bucket = this.buckets[access];

    await uploadS3Files([tempFile], bucket, '');

    // delete temp file
    fs.unlinkSync(tempFile);

    return {
      key,
      uri: `s3://${bucket}/${file.filename}`
    };
  }
}

/**
 * Ingest Granule from a FTP endpoint.
 *
 * @class
 */

class FtpGranule extends ftpMixin(Granule) {}

/**
 * Ingest Granule from a HTTP endpoint.
 *
 * @class
 */

class HttpGranule extends httpMixin(Granule) {}

module.exports.HttpGranule = HttpGranule;
module.exports.FtpGranule = FtpGranule;
