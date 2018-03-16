'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs-extra');
const get = require('lodash.get');
const os = require('os');
const path = require('path');
const urljoin = require('url-join');
const cksum = require('cksum');
const checksum = require('checksum');
const errors = require('@cumulus/common/errors');
const sftpMixin = require('./sftp');
const ftpMixin = require('./ftp').ftpMixin;
const httpMixin = require('./http').httpMixin;
const s3Mixin = require('./s3').s3Mixin;
const { baseProtocol } = require('./protocol');

class Discover {
  constructor(event) {
    if (this.constructor === Discover) {
      throw new TypeError('Can not construct abstract class.');
    }

    const config = get(event, 'config');

    this.buckets = get(config, 'buckets');
    this.collection = get(config, 'collection');
    this.provider = get(config, 'provider');
    this.useList = get(config, 'useList');
    this.event = event;

    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);
    this.path = get(this.collection, 'provider_path') || '/';

    this.endpoint = urljoin(this.host, this.path);
    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);

    // create hash with file regex as key
    this.regexes = {};
    this.collection.files.forEach((f) => {
      this.regexes[f.regex] = {
        collection: this.collection.name,
        bucket: this.buckets[f.bucket]
      };
    });
  }

  /**
   * Receives a file object and adds granule, bucket and path information
   * extracted from the collection record
   * @param {object} file the file object
   * @returns {object} Updated file with granuleId, bucket and path information
   */
  setGranuleInfo(_file) {
    let granuleId;
    const file = _file;
    let test = new RegExp(this.collection.granuleIdExtraction);
    const match = file.name.match(test);
    if (match) {
      granuleId = match[1];
      for (const f of this.collection.files) {
        test = new RegExp(f.regex);
        if (file.name.match(test)) {
          file.granuleId = granuleId;
          file.bucket = this.buckets[f.bucket];
          if (f.url_path) {
            file.url_path = f.url_path;
          }
          else {
            file.url_path = this.collection.url_path || '';
          }
        }
      }

      // if collection regex matched, the following will be true
      if (file.granuleId && file.bucket) {
        return file;
      }
    }
    return false;
  }

  async discover() {
    // get list of files that matches a given path
    const updatedFiles = (await this.list())
      .map((file) => this.setGranuleInfo(file))
      .filter((file) => file);

    return await this.findNewGranules(updatedFiles);
  }

  /**
   * Determine if a file does not yet exist in S3.
   *
   * @param {Object} file - the file that's being looked for
   * @param {string} file.bucket - the bucket to look in
   * @param {string} file.name - the name of the file (in S3)
   * @returns {Promise.<(boolean|Object)>} - a Promise that resolves to false
   *   when the object exists in S3, or the passed-in file object if it does
   *   not already exist in S3.
   */
  fileIsNew(file) {
    return aws.s3ObjectExists({
      Bucket: file.bucket,
      Key: file.name
    }).then((exists) => (exists ? false : file));
  }

  async findNewGranules(files) {
    const checkFiles = files.map((f) => this.fileIsNew(f));
    const t = await Promise.all(checkFiles);
    const newFiles = t.filter((f) => f);

    // reorganize by granule
    const granules = {};
    newFiles.forEach((_f) => {
      const f = _f;
      const granuleId = f.granuleId;
      delete f.granuleId;
      if (granules[granuleId]) {
        granules[granuleId].files.push(f);
      }
      else {
        granules[granuleId] = {
          granuleId,
          files: [f]
        };
      }
    });

    return Object.keys(granules).map((k) => granules[k]);
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
  constructor(
    buckets,
    collection,
    provider,
    forceDownload = false
  ) {
    if (this.constructor === Granule) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.buckets = buckets;
    this.collection = collection;
    this.provider = provider;

    this.collection.url_path = this.collection.url_path || '';
    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);
    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);
    this.checksumFiles = {};

    this.forceDownload = forceDownload;
  }

  async ingest(granule) {
    // for each granule file
    // download / verify checksum / upload

    const downloadFiles = granule.files
      .map((f) => this.getBucket(f))
      .filter((f) => this.filterChecksumFiles(f))
      .map((f) => this.ingestFile(f, this.collection.duplicateHandling));

    const files = await Promise.all(downloadFiles);

    return {
      granuleId: granule.granuleId,
      files
    };
  }

  getBucket(_file) {
    const file = _file;
    for (const fileDef of this.collection.files) {
      const test = new RegExp(fileDef.regex);
      const match = file.name.match(test);
      if (match) {
        file.bucket = this.buckets[fileDef.bucket];
        file.url_path = fileDef.url_path || this.collection.url_path;
        return file;
      }
    }
    // if not found fall back to default
    file.bucket = this.buckets.private;
    file.url_path = this.collection.url_path || '';
    return file;
  }

  filterChecksumFiles(file) {
    if (file.name.indexOf('.md5') > 0) {
      this.checksumFiles[file.name.replace('.md5', '')] = file;
      return false;
    }

    return true;
  }

  /**
   * Validate a file's checksum and throw an exception if it's invalid
   *
   * @param {Object} file - the file object to be checked
   * @param {string} fileLocalPath - the path to the file on the filesystem
   * @param {Object} [options={}] - options for the this._hash method
   * @returns {undefined} - no return value, but throws an error if the
   *   checksum is invalid
   * @memberof Granule
   */
  async validateChecksum(file, fileLocalPath, options = {}) {
    const [type, value] = await this.getChecksumFromFile(file);

    if (!type || !value) return;

    let sum = null;
    if (type.toLowerCase() === 'cksum') sum = await this._cksum(fileLocalPath);
    else sum = await this._hash(type, fileLocalPath, options);

    if (value !== sum) {
      const message = `Invalid checksum for ${file.name} with type ${file.checksumType} and value ${file.checksumValue}`; // eslint-disable-line max-len
      throw new errors.InvalidChecksum(message);
    }
  }

  async _cksum(tempFile) {
    return new Promise((resolve, reject) =>
      fs.createReadStream(tempFile)
        .pipe(cksum.stream((value) => resolve(value.readUInt32BE(0))))
        .on('error', reject)
    );
  }

  async _hash(type, tempFile) {
    const options = { algorithm: type };

    return new Promise((resolve, reject) =>
      checksum.file(tempFile, options, (err, sum) => {
        if (err) return reject(err);
        return resolve(sum);
      })
    );
  }

  async enableDuplicateHandling(bucket) {
    // check that the bucket has versioning enabled
    const versioning = await aws.s3().getBucketVersioning({ Bucket: bucket }).promise();

    // if not enabled, make it enabled
    if (versioning.Status !== 'Enabled') {
      return aws.s3().putBucketVersioning({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' } }).promise();
    }
  }

  async getChecksumFromFile(file) {
    if (file.checksumType && file.checksumValue) {
      return [file.checksumType, file.checksumValue];
    }
    else if (this.checksumFiles[file.name]) {
      const checksumInfo = this.checksumFiles[file.name];

      const checksumRemotePath = path.join(checksumInfo.path, checksumInfo.name);

      const downloadDir = await fs.mkdtemp(`${os.tmpdir()}${path.sep}`);
      const checksumLocalPath = path.join(downloadDir, checksumInfo.name);

      let checksumValue;
      try {
        await this.download(checksumRemotePath, checksumLocalPath);
        checksumValue = (await fs.readFile(checksumLocalPath, 'utf8')).split(' ')[0];
      }
      finally {
        await fs.remove(downloadDir);
      }

      // assuming the type is md5
      return ['md5', checksumValue];
    }

    // No checksum found
    return [null, null];
  }

  /**
   * Ingest individual files
   * @private
   */
  async ingestFile(file, duplicateHandling) {
    // Check if the file exists
    const exists = await aws.s3ObjectExists({
      Bucket: file.bucket,
      Key: path.join(file.url_path, file.name)
    });

    // Exit early if we can
    if (exists && duplicateHandling === 'skip') return file;

    // Enable duplicate handling
    if (duplicateHandling === 'version') this.enableDuplicateHandling(file.bucket);

    // Either the file does not exist yet, or it does but
    // we are replacing it with a more recent one or
    // adding another version of it to the bucket

    // we considered a direct stream from source to S3 but since
    // it doesn't work with FTP connections, we decided to always download
    // and then upload

    const downloadDir = await this.createDownloadDirectory();
    try {
      const fileLocalPath = path.join(downloadDir, file.name);
      const fileRemotePath = path.join(file.path, file.name);

      // Download the file
      await this.download(fileRemotePath, fileLocalPath);

      // Validate the checksum
      await this.validateChecksum(file, fileLocalPath);

      // Upload the file
      const filename = await this.upload(file.bucket, file.url_path, file.name, fileLocalPath);

      return Object.assign({}, file, { filename });
    }
    finally {
      // Delete the temp directory
      await fs.remove(downloadDir);
    }
  }
}

/**
 * A class for discovering granules using HTTP or HTTPS.
 */
class HttpDiscoverGranules extends httpMixin(baseProtocol(Discover)) {}

/**
 * A class for discovering granules using SFTP.
 */
class SftpDiscoverGranules extends sftpMixin(baseProtocol(Discover)) {}

/**
 * A class for discovering granules using FTP.
 */
class FtpDiscoverGranules extends ftpMixin(baseProtocol(Discover)) {}

/**
 * A class for discovering granules using S3.
 */
class S3DiscoverGranules extends s3Mixin(baseProtocol(Discover)) {}

/**
 * Ingest Granule from an FTP endpoint.
 */
class FtpGranule extends ftpMixin(baseProtocol(Granule)) {}

/**
 * Ingest Granule from an SFTP endpoint.
 */
class SftpGranule extends sftpMixin(baseProtocol(Granule)) {}

/**
 * Ingest Granule from an HTTP endpoint.
 */
class HttpGranule extends httpMixin(baseProtocol(Granule)) {}

/**
 * Ingest Granule from an s3 endpoint.
 */
class S3Granule extends s3Mixin(baseProtocol(Granule)) {}

/**
* Select a class for discovering or ingesting granules based on protocol
*
* @param {string} type -`discover` or `ingest`
* @param {string} protocol -`sftp`, `ftp`, `http` or `s3`
* @returns {function} - a constructor to create a granule discovery object
**/
function selector(type, protocol) {
  if (type === 'discover') {
    switch (protocol) {
    case 'sftp':
      return SftpDiscoverGranules;
    case 'ftp':
      return FtpDiscoverGranules;
    case 'http':
    case 'https':
      return HttpDiscoverGranules;
    case 's3':
      return S3DiscoverGranules;
    default:
      throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }
  else if (type === 'ingest') {
    switch (protocol) {
    case 'sftp':
      return SftpGranule;
    case 'ftp':
      return FtpGranule;
    case 'http':
      return HttpGranule;
    case 's3':
      return S3Granule;
    default:
      throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }

  throw new Error(`${type} is not supported`);
}

module.exports.selector = selector;
module.exports.FtpDiscoverGranules = FtpDiscoverGranules;
module.exports.FtpGranule = FtpGranule;
module.exports.HttpDiscoverGranules = HttpDiscoverGranules;
module.exports.HttpGranule = HttpGranule;
module.exports.S3Granule = S3Granule;
module.exports.S3DiscoverGranules = S3DiscoverGranules;
module.exports.SftpDiscoverGranules = SftpDiscoverGranules;
module.exports.SftpGranule = SftpGranule;
