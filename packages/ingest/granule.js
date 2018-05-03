'use strict';

const deprecate = require('depd')('my-module');
const aws = require('@cumulus/common/aws');
const fs = require('fs-extra');
const cloneDeep = require('lodash.clonedeep');
const get = require('lodash.get');
const os = require('os');
const path = require('path');
const urljoin = require('url-join');
const encodeurl = require('encodeurl');
const cksum = require('cksum');
const checksum = require('checksum');
const errors = require('@cumulus/common/errors');
const { sftpMixin } = require('./sftp');
const { ftpMixin } = require('./ftp');
const { httpMixin } = require('./http');
const { s3Mixin } = require('./s3');
const { baseProtocol } = require('./protocol');

/**
* The abstract Discover class
**/
class Discover {
  /**
  * Discover class constructor
  *
  * @param {Object} event - the cumulus event object
  **/
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
   *
   * @param {Object} file - the file object
   * @returns {Object} - Updated file with granuleId, bucket and path information
   */
  setGranuleInfo(file) {
    const _file = file;
    let test = new RegExp(this.collection.granuleIdExtraction);
    const match = file.name.match(test);

    if (match) {
      const granuleId = match[1];

      this.collection.files.forEach((f) => {
        test = new RegExp(f.regex);
        const urlPath = f.url_path || this.collection.url_path || '';

        if (file.name.match(test)) {
          _file.granuleId = granuleId;
          _file.bucket = this.buckets[f.bucket];
          _file.url_path = urlPath;
        }
      });

      // if collection regex matched, the following will be true
      if (_file.granuleId && _file.bucket) {
        return _file;
      }
    }

    return false;
  }

  /**
  * Discover new files that match a given path
  *
  * @returns {Array} an array of granule objects
  **/
  async discover() {
    // get list of files that matches a given path
    const updatedFiles = (await this.list())
      .map((file) => this.setGranuleInfo(file))
      .filter((file) => file);

    return this.findNewGranules(updatedFiles);
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

  /**
   * Find new granules and format them as array of objects
   *
   * @param {Array} files - An array of objects with `bucket` and `name` properties
   * that work as AWS S3 `Bucket` and `Key`
   * @returns {Array} an array of granule objects
   */
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
  /**
   * Constructor for abstract Granule class
   *
   * @param {Object} buckets - s3 buckets available from config
   * @param {Object} collection - collection configuration object
   * @param {Object} provider - provider configuration object
   * @param {string} fileStagingDir - staging directory on bucket to place files
   * @param {boolean} forceDownload - force download of a file
   */
  constructor(
    buckets,
    collection,
    provider,
    fileStagingDir = 'file-staging',
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
    this.fileStagingDir = fileStagingDir;
  }

  /**
   * Ingest all files in a granule
   *
   * @param {Object} granule - granule object
   * @param {string} bucket - s3 bucket to use for files
   * @returns {Promise<Object>} return granule object
   */
  async ingest(granule, bucket) {
    // for each granule file
    // download / verify checksum / upload

    const downloadFiles = granule.files
      .filter((f) => this.filterChecksumFiles(f))
      .map((f) => this.ingestFile(f, bucket, this.collection.duplicateHandling));

    const files = await Promise.all(downloadFiles);

    return {
      granuleId: granule.granuleId,
      files
    };
  }

  /**
   * set the url_path of a file based on collection config.
   * Give a url_path set on a file definition higher priority
   * than a url_path set on the min collection object.
   *
   * @param {Object} file - object representing a file of a granule
   * @returns {Object} file object updated with url+path tenplate
   */
  getUrlPath(file) {
    let urlPath = '';

    this.collection.files.forEach((fileDef) => {
      const test = new RegExp(fileDef.regex);
      const match = file.name.match(test);

      if (match && fileDef.url_path) {
        urlPath = fileDef.url_path;
      }
    });

    if (!urlPath) {
      urlPath = this.collection.url_path;
    }

    return urlPath;
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

    // eslint-disable-next-line camelcase
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

  /**
   * Filter out md5 checksum files and put them in `this.checksumFiles` object.
   * To be used with `Array.prototype.filter`.
   *
   * @param {Object} file - file object from granule.files
   * @returns {boolean} depending on if file was an md5 checksum or not
   */
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

  /**
   * Get cksum checksum value of file
   *
   * @param {string} filepath - filepath of file to checksum
   * @returns {Promise<number>} checksum value calculated from file
   */
  async _cksum(filepath) {
    return new Promise((resolve, reject) =>
      fs.createReadStream(filepath)
        .pipe(cksum.stream((value) => resolve(value.readUInt32BE(0))))
        .on('error', reject));
  }

  /**
  * Get hash of file
  *
  * @param {string} algorithm - algorithm to use for hash,
  * any algorithm accepted by node's `crypto.createHash`
  * https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm_options
  * @param {string} filepath - filepath of file to checksum
  * @returns {Promise} checksum value calculated from file
  **/
  async _hash(algorithm, filepath) {
    const options = { algorithm };

    return new Promise((resolve, reject) =>
      checksum.file(filepath, options, (err, sum) => {
        if (err) return reject(err);
        return resolve(sum);
      }));
  }

  /**
   * Enable versioning on an s3 bucket
   *
   * @param {string} bucket - s3 bucket name
   * @returns {Promise} promise that resolves when bucket versioning is enabled
   */
  async enableBucketVersioning(bucket) {
    // check that the bucket has versioning enabled
    const versioning = await aws.s3().getBucketVersioning({ Bucket: bucket }).promise();

    // if not enabled, make it enabled
    if (versioning.Status !== 'Enabled') {
      aws.s3().putBucketVersioning({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' }
      }).promise();
    }
  }

  /**
   * Get a checksum from a file
   *
   * @param {Object} file - file object
   * @returns {Array} returns array where first item is the checksum algorithm,
   * and the second item is the value of the checksum
   */
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
        const checksumFile = await fs.readFile(checksumLocalPath, 'utf8');
        [checksumValue] = checksumFile.split(' ');
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
   *
   * @private
   * @param {Object} file - file to download
   * @param {string} bucket - bucket to put file in
   * @param {string} duplicateHandling - how to handle duplicate files
   * value can be `skip` to skip duplicates,
   * or 'version' to create a new version of the file in s3
   * @returns {Promise<Object>} returns promise that resolves to a file object
   */
  async ingestFile(file, bucket, duplicateHandling) {
    // Check if the file exists
    const exists = await aws.s3ObjectExists({
      Bucket: bucket,
      Key: path.join(this.fileStagingDir, file.name)
    });

    // Exit early if we can
    if (exists && duplicateHandling === 'skip') return file;

    // Enable bucket versioning
    if (duplicateHandling === 'version') this.enableBucketVersioning(file.bucket);

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
      const filename = await this.upload(
        bucket,
        this.fileStagingDir,
        file.name,
        fileLocalPath
      );

      return Object.assign(file, {
        filename,
        fileStagingDir: this.fileStagingDir,
        url_path: this.getUrlPath(file),
        bucket
      });
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

/**
* Copy granule file from one s3 bucket & keypath to another
*
* @param {Object} source - source
* @param {string} source.Bucket - source
* @param {string} source.Key - source
* @param {Object} target - target
* @param {string} target.Bucket - target
* @param {string} target.Key - target
* @param {Object} options - optional object with properties as defined by AWS API:
* https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property
* @returns {Promise} returms a promise that is resolved when the file is copied
**/
function copyGranuleFile(source, target, options) {
  const s3 = aws.s3();
  const CopySource = encodeurl(`/${source.Bucket}/${source.Key}`);

  const params = Object.assign({
    CopySource,
    Bucket: target.Bucket,
    Key: target.Key
  }, (options || {}));

  return s3.copyObject(params).promise();
}

/**
* Move granule file from one s3 bucket & keypath to another
*
* @param {Object} source - source
* @param {string} source.Bucket - source
* @param {string} source.Key - source
* @param {Object} target - target
* @param {string} target.Bucket - target
* @param {string} target.Key - target
* @param {Object} options - optional object with properties as defined by AWS API:
* https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-prop
* @returns {Promise} returms a promise that is resolved when the file is moved
**/
async function moveGranuleFile(source, target, options) {
  const s3 = aws.s3();
  await copyGranuleFile(source, target, options);
  return s3.deleteObject(source).promise();
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
module.exports.copyGranuleFile = copyGranuleFile;
module.exports.moveGranuleFile = moveGranuleFile;
