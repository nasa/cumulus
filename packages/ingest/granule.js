'use strict';

const fs = require('fs');
const join = require('path').join;
const get = require('lodash.get');
const urljoin = require('url-join');
const uploadS3Files = require('@cumulus/common/aws').uploadS3Files;
const errors = require('@cumulus/common/errors');
const S3 = require('./aws').S3;
const queue = require('./queue');
const sftpMixin = require('./sftp');
const ftpMixin = require('./ftp').ftpMixin;
const httpMixin = require('./http').httpMixin;

class Discover {
  constructor(buckets, collections, provider) {
    if (this.constructor === Discover) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.buckets = buckets;
    this.port = get(provider, 'port', 21);
    this.host = get(provider, 'host', null);
    this.path = get(provider, 'path', '/');
    this.provider = provider;
    this.collections = collections;
    this.endpoint = urljoin(this.host, this.path);
    this.username = get(provider, 'username', null);
    this.password = get(provider, 'password', null);

    // create hash with file regex as key
    this.regexes = {};
    Object.keys(collections).forEach((name) => {
      const c = collections[name];
      Object.keys(c.files).forEach((key) => {
        const f = c.files[key];
        this.regexes[f.regex] = {
          collection: name,
          bucket: this.buckets[f.bucket],
          definitionName: key
        };
      });
    });
  }

  getCollection(file) {
    for (const r of Object.keys(this.regexes)) {
      if (file.name.match(r)) {
        let granuleId;
        const collection = this.collections[this.regexes[r].collection];
        const test = new RegExp(collection.granuleIdExtraction);
        const match = file.name.match(test);
        if (match) {
          granuleId = match[1];
        }

        return Object.assign({}, {
          filename: file.name,
          path: file.path,
          filesize: file.size,
          modifyTime: file.modifyTime,
          granuleId
        }, this.regexes[r]);
      }
    }

    return false;
  }

  async discover() {
    const list = await this._list();

    // flatten list
    const flatten = [];
    Object.keys(list).forEach((p) => {
      list[p].forEach(_item => {
        const item = _item;
        item.path = p;
        flatten.push(item);
      });
    });

    // pass list through regex list and get their
    // location on cumulus to check if they exist
    const files = flatten.map(item => this.getCollection(item)).filter(item => item);
    return await this.findNewGranules(files);
  }

  async fileIsNew(file) {
    const exists = await S3.fileExists(file.bucket, file.filename);
    return exists ? false : file;
  }

  async findNewGranules(files) {
    const checkFiles = files.map(f => this.fileIsNew(f));
    const t = await Promise.all(checkFiles);
    const newFiles = t.filter(f => f);

    // reorganize by granule
    const granules = {};
    newFiles.forEach(_f => {
      const f = _f;
      const granuleId = f.granuleId;
      const collection = f.collection;
      delete f.granuleId;
      delete f.collection;
      if (granules[f.granuleId]) {
        granules[granuleId].files.push(f);
      }
      else {
        granules[granuleId] = {
          collection,
          granuleId,
          files: [f]
        };
      }
    });

    return granules;
  }
}

/**
 * This is a base class for discovering PDRs
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */
class DiscoverAndQueue extends Discover {
  constructor(event) {
    const buckets = get(event, 'resources.buckets');
    const collections = get(event, 'meta.collections');
    const provider = get(event, 'provider');

    super(buckets, collections, provider);
    this.event = event;
  }

  async findNewGranules(files) {
    const granules = await super.findNewGranules(files);
    return Promise.all(Object.values(granules).map(g => queue.queueGranule(this.event, g)));
  }
}


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
    let tempFile;
    try {
      tempFile = await this._download(this.host, file.path, file.filename);
    }
    catch (e) {
      if (e.message && e.message.includes('Unexpected HTTP status code: 403')) {
        throw new errors.FileNotFound(
          `${file.filename} was not found on the server with 403 status`
        );
      }
      throw e;
    }

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

class SftpDiscoverGranules extends sftpMixin(Discover) {}

/**
 * Ingest Granule from a FTP endpoint.
 *
 * @class
 */

class SftpDiscoverAndQueueGranules extends sftpMixin(DiscoverAndQueue) {}


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
module.exports.SftpDiscoverGranules = SftpDiscoverGranules;
module.exports.SftpDiscoverAndQueueGranules = SftpDiscoverAndQueueGranules;
