'use strict';

const deprecate = require('depd')('my-module');
const aws = require('@cumulus/common/aws');
const fs = require('fs-extra');
const cloneDeep = require('lodash.clonedeep');
const get = require('lodash.get');
const groupBy = require('lodash.groupby');
const identity = require('lodash.identity');
const omit = require('lodash.omit');
const os = require('os');
const path = require('path');
const urljoin = require('url-join');
const cksum = require('cksum');
const checksum = require('checksum');
const errors = require('@cumulus/common/errors');
const { sftpMixin } = require('./sftp');
const { ftpMixin } = require('./ftp');
const { httpMixin } = require('./http');
const { s3Mixin } = require('./s3');
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
   * Receives a file object and adds granule-specific properties to it
   *
   * @param {Object} file - the file object
   * @returns {Object} Updated file with granuleId, bucket, and url_path information
   */
  setGranuleInfo(file) {
    const granuleIdMatch = file.name.match(this.collection.granuleIdExtraction);
    const fileTypeConfig = this.fileTypeConfigForFile(file);

    // Return the file with granuleId, bucket, and url_path added
    return Object.assign(
      cloneDeep(file),
      {
        granuleId: granuleIdMatch[1],
        bucket: this.buckets[fileTypeConfig.bucket],
        url_path: fileTypeConfig.url_path || this.collection.url_path || ''
      }
    );
  }

  fileTypeConfigForFile(file) {
    return this.collection.files.find((fileTypeConfig) => file.name.match(fileTypeConfig.regex));
  }

  async discover() {
    const discoveredFiles = (await this.list())
      // Make sure the file matches the granuleIdExtraction
      .filter((file) => file.name.match(this.collection.granuleIdExtraction))
      // Make sure there is a config for this type of file
      .filter((file) => this.fileTypeConfigForFile(file))
      // Add additional granule-related properties to the file
      .map((file) => this.setGranuleInfo(file));

    // This is a little confusing, but I haven't figured out a better way to
    // write it.  What we're doing here is checking each discovered file to see
    // if it already exists in S3.  If it does then it isn't a new file and we
    // are going to ignore it.
    const newFiles = (await Promise.all( // eslint-disable-line function-paren-newline
      discoveredFiles.map(async (file) => {
        if (await aws.s3ObjectExists({ Bucket: file.bucket, Key: file.name })) return null;
        return file;
      })
    )).filter(identity); // eslint-disable-line function-paren-newline

    // Group the files by granuleId
    const filesByGranuleId = groupBy(newFiles, (file) => file.granuleId);

    // Build and return the granules
    const granuleIds = Object.keys(filesByGranuleId);
    return granuleIds
      .map((granuleId) => ({
        granuleId,
        dataType: this.collection.name,
        // Remove the granuleId property from each file
        files: filesByGranuleId[granuleId].map((file) => omit(file, 'granuleId'))
      }));
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
      .filter((f) => this.filterChecksumFiles(f))
      .map((f) => this.addBucketToFile(f))
      .map((f) => this.addUrlPathToFile(f))
      .map((f) => this.ingestFile(f, this.collection.duplicateHandling));

    const files = await Promise.all(downloadFiles);

    return {
      granuleId: granule.granuleId,
      files
    };
  }

  /**
   * Find the collection file config that applies to the given file
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object|undefined} a collection file config or undefined
   * @private
   */
  findCollectionFileConfigForFile(file) {
    return this.collection.files.find((fileConfig) =>
      file.name.match(fileConfig.regex));
  }

  /**
   * Add a bucket property to the given file
   *
   * Note: This returns a copy of the file parameter, it does not modify it.
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object} the file with a bucket property set
   * @private
   */
  addBucketToFile(file) {
    let bucket = this.buckets.private;

    const fileConfig = this.findCollectionFileConfigForFile(file);
    if (fileConfig) bucket = this.buckets[fileConfig.bucket];

    return Object.assign(cloneDeep(file), { bucket });
  }

  /**
   * Add a url_path property to the given file
   *
   * Note: This returns a copy of the file parameter, it does not modify it.
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object} the file with a url_path property set
   * @private
   */
  addUrlPathToFile(file) {
    let foundFileConfigUrlPath;

    const fileConfig = this.findCollectionFileConfigForFile(file);
    if (fileConfig) foundFileConfigUrlPath = fileConfig.url_path;

    const url_path = foundFileConfigUrlPath || this.collection.url_path || '';
    return Object.assign(cloneDeep(file), { url_path });
  }

  /**
   * Add bucket and url_path properties to the given file
   *
   * Note: This returns a copy of the file parameter, it does not modify it.
   *
   * This method is deprecated.  A combination of the addBucketToFile and
   *   addUrlPathToFile methods should be used instead.
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object} the file with bucket and url_path properties set
   * @private
   */
  getBucket(file) {
    deprecate();
    return this.addUrlPathToFile(this.addBucketToFile(file));
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
exports.Granule = Granule; // exported to support testing

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
* @param {string} protocol -`sftp`, `ftp`, `http`, `https` or `s3`
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
    case 'https':
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
